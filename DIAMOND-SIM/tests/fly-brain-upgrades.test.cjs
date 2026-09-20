const test = require("node:test");
const assert = require("node:assert/strict");
const FlyBrainEngine = require("../src/fly-brain-engine.js");

const {
  MulberryPRNG,
  SixteenFlyBrainSyncytium,
  MultiAgentGraphGraft,
  FlyBrainStateSerializer
} = FlyBrainEngine;

const OBS = (x, y, energy = 0.8, hazard = 0.05) => [
  x, y, 0.25, hazard, energy, 0.4,
  Math.sin(0.7), Math.cos(0.7),
  Math.sin(2.1), Math.cos(2.1),
  0, 0, 0.12, 0.05
];

function bornPoolSignature(syncytium) {
  return syncytium.brains
    .map(b => b.bornNeurons
      .map(n => `${n.id}:${Array.from(n.weights).join(",")}:${Array.from(n.mbonWeights).join(",")}`)
      .join("|"))
    .join("#");
}

// ─────────────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────────────
test("neurogenesis grows identical Kenyon cell pools from identical world seeds", () => {
  const grow = seed => {
    const syncytium = new SixteenFlyBrainSyncytium(seed);
    for (let t = 0; t < 25; t++) syncytium.step(OBS(0.5, 0.5), 0.1, 0.9, 100);
    return syncytium;
  };

  const a = grow(7);
  const b = grow(7);
  assert.ok(a.neurogenesis.mitosisCount > 0, "the probe must actually trigger mitosis");
  assert.equal(
    bornPoolSignature(a),
    bornPoolSignature(b),
    "born Kenyon cells must be reproducible from the world seed alone"
  );

  const c = grow(8);
  assert.notEqual(bornPoolSignature(a), bornPoolSignature(c), "distinct seeds must diverge");
});

test("born neuron identifiers carry a birth index rather than a wall clock", () => {
  const syncytium = new SixteenFlyBrainSyncytium(11);
  for (let t = 0; t < 12; t++) syncytium.step(OBS(0.4, 0.6), 0.1, 0.9, 100);
  const ids = syncytium.brains.flatMap(b => b.bornNeurons.map(n => n.id));
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.match(id, /^\d+_born_\d+$/);
    assert.ok(!/1[6-9]\d{11}/.test(id), `id ${id} must not embed a millisecond timestamp`);
  }
});

test("engrams and beacons are stamped with simulation steps, not wall-clock time", () => {
  const graft = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(3), 0.55);
  graft.feedback(5, false, { x: 0.5, y: 0.5 });
  const engram = graft.syncytium.engramBank[0];
  assert.ok(engram, "reward must consolidate an engram");
  assert.equal(typeof engram.step, "number");
  assert.equal(engram.timestamp, undefined, "wall-clock stamps make saved state irreproducible");
});

// ─────────────────────────────────────────────────────────────────────────────
// Exact resume
// ─────────────────────────────────────────────────────────────────────────────
test("MulberryPRNG state round-trips so a resumed stream continues exactly", () => {
  const source = new MulberryPRNG(99);
  for (let i = 0; i < 17; i++) source.next();
  const snapshot = source.getState();
  const expected = Array.from({ length: 5 }, () => source.next());

  const resumed = new MulberryPRNG(99).setState(snapshot);
  assert.deepEqual(Array.from({ length: 5 }, () => resumed.next()), expected);
  assert.equal(resumed.drawCount, snapshot.drawCount + 5, "draw bookkeeping must continue too");

  // The draw count alone cannot place the stream, which is why v6 files could
  // not be resumed exactly.
  const countOnly = new MulberryPRNG(99);
  countOnly.drawCount = snapshot.drawCount;
  assert.notEqual(countOnly.next(), expected[0]);
});

test("forked streams are independent of the parent's draw position", () => {
  const parent = new MulberryPRNG(5);
  const forkBefore = Array.from({ length: 4 }, () => parent.fork(2).next());
  for (let i = 0; i < 50; i++) parent.next();
  const forkAfter = parent.fork(2).next();
  assert.equal(forkBefore[0], forkAfter, "a fork must depend on the seed, not the cursor");
  assert.notEqual(parent.fork(2).next(), parent.fork(3).next(), "different salts must differ");
});

test("serialized state restores both generators so neurogenesis replays exactly", () => {
  const live = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(4242), 0.55);
  for (let t = 0; t < 20; t++) live.syncytium.step(OBS(0.5, 0.5), 0.1, 0.9, 100);
  const json = FlyBrainStateSerializer.serialize(live);

  const advance = graft => {
    for (let t = 0; t < 10; t++) graft.syncytium.step(OBS(0.5, 0.5), 0.1, 0.9, 100);
    return bornPoolSignature(graft.syncytium);
  };

  const continued = advance(live);

  const restored = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(1), 0.55);
  FlyBrainStateSerializer.deserialize(restored, json);
  assert.equal(
    advance(restored),
    continued,
    "a restored run must grow the same neurons as the run it was saved from"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// One tick is one tick, whatever the swarm size
// ─────────────────────────────────────────────────────────────────────────────
test("the circadian clock advances once per environment tick, not once per fly", () => {
  const env = {
    agent1X: 2, agent1Y: 2, agent1Energy: 100,
    agent2X: 8, agent2Y: 18, agent2Energy: 100,
    agent3X: 19, agent3Y: 1, agent3Energy: 100
  };
  const graft = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(5), 0.55);
  graft.resolveAgents(env, OBS(0.1, 0.1), OBS(0.4, 0.9), OBS(0.95, 0.05));

  assert.equal(graft.syncytium.tickCount, 1, "three flies still share one tick");
  assert.equal(graft.syncytium.circadianClock, 1);
  assert.equal(graft.syncytium.syncytiumSteps, 3, "each fly still runs its own forward pass");
});

test("a single-fly caller keeps one tick per forward pass", () => {
  const syncytium = new SixteenFlyBrainSyncytium(5);
  for (let t = 0; t < 9; t++) syncytium.step(OBS(0.5, 0.5), 0, 0, 100);
  assert.equal(syncytium.tickCount, 9);
  assert.equal(syncytium.circadianClock, 9);
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared connectome, separate bodies
// ─────────────────────────────────────────────────────────────────────────────
test("flies sharing one connectome keep separate heading and metabolic registers", () => {
  const env = {
    agent1X: 2, agent1Y: 2, agent1Energy: 24,
    agent2X: 8, agent2Y: 18, agent2Energy: 156,
    agent3X: 19, agent3Y: 1, agent3Energy: 100
  };
  const graft = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(5), 0.55);
  for (let t = 0; t < 4; t++) {
    graft.resolveAgents(env, OBS(0.1, 0.1, 0.2), OBS(0.4, 0.9, 1.3), OBS(0.95, 0.05, 0.8));
  }

  const heading = key => graft.syncytium.egoStates.get(key)[1].scalars.compassHeading;
  const headings = [heading("agent1"), heading("agent2"), heading("agent3")];
  assert.equal(new Set(headings.map(h => h.toFixed(6))).size, 3, "each fly holds its own compass");

  const sugar = key => graft.syncytium.egoStates.get(key)[7].scalars.sugarDrive;
  assert.ok(
    sugar("agent1") > sugar("agent2"),
    "the starving fly must keep a higher sugar drive than the sated one"
  );
});

test("one fly's forward pass leaves another fly's registers untouched", () => {
  const syncytium = new SixteenFlyBrainSyncytium(21);
  syncytium.step(OBS(0.1, 0.1, 0.2), 0.9, 0, 30, null, "left");
  const before = Array.from(syncytium.egoStates.get("left")[1].arrays.compassRing);

  for (let t = 0; t < 6; t++) syncytium.step(OBS(0.9, 0.9, 1.2), -0.4, 0, 150, null, "right");

  const after = Array.from(syncytium.egoStates.get("left")[1].arrays.compassRing);
  assert.deepEqual(after, before, "stepping one fly must not rewrite another's compass bump");
});

test("a new fly starts from pristine registers instead of inheriting the last one", () => {
  const syncytium = new SixteenFlyBrainSyncytium(21);
  for (let t = 0; t < 30; t++) syncytium.step(OBS(0.9, 0.9), 0.7, 0, 100, null, "veteran");
  const veteran = syncytium.egoStates.get("veteran")[1].scalars.compassHeading;
  assert.ok(veteran !== 0, "the veteran must have accumulated heading");

  syncytium.loadEgo("newcomer");
  assert.equal(
    syncytium.brains[1].compassHeading,
    0,
    "a fresh fly must not wake up holding another individual's heading"
  );
});

test("reward credit lands on the fly that earned it", () => {
  const syncytium = new SixteenFlyBrainSyncytium(77);
  // Two flies see different odours, so different Kenyon cells are active.
  syncytium.step(OBS(0.15, 0.15), 0.2, 0, 100, null, "a");
  syncytium.step(OBS(0.85, 0.85), -0.2, 0, 100, null, "b");

  const activeFor = key => {
    syncytium.loadEgo(key);
    return syncytium.brains[3].kcActivations.findIndex(v => v > 0.01);
  };
  const activeA = activeFor("a");
  const activeB = activeFor("b");
  assert.ok(activeA >= 0 && activeB >= 0, "both flies must have some active Kenyon cell");

  const before = syncytium.brains[3].kcToMbonWeights.slice();
  syncytium.applyReinforcement(2.0, 0, { x: 0.85, y: 0.85 }, "b");
  const after = syncytium.brains[3].kcToMbonWeights;

  const changedRow = index => {
    for (let m = 0; m < syncytium.brains[3].MBON_COUNT; m++) {
      if (Math.abs(after[index * syncytium.brains[3].MBON_COUNT + m] - before[index * syncytium.brains[3].MBON_COUNT + m]) > 1e-9) {
        return true;
      }
    }
    return false;
  };

  assert.ok(changedRow(activeB), "the rewarded fly's active synapses must change");
  if (activeA !== activeB) {
    assert.ok(!changedRow(activeA), "the other fly's synapses must not absorb the credit");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Central Complex ring attractor
// ─────────────────────────────────────────────────────────────────────────────
const { DrosophilaBrain, angleDelta, DEFAULT_CONFIG, LEGACY_CONFIG } = FlyBrainEngine;

function integrateHeading(brain, angularVelocity, ticks) {
  let previous = brain.compassHeading;
  let total = 0;
  for (let t = 0; t < ticks; t++) {
    const heading = brain.updateRingAttractor(angularVelocity);
    total += angleDelta(heading, previous);
    previous = heading;
  }
  return total;
}

test("the E-PG ring integrates angular velocity with near-unit gain in both directions", () => {
  for (const omega of [0.05, 0.12, 0.28, -0.17, -0.4]) {
    const brain = new DrosophilaBrain(1, "navigator");
    const travelled = integrateHeading(brain, omega, 40);
    const gain = travelled / (omega * 40);
    assert.ok(
      gain > 0.9 && gain < 1.1,
      `velocity gain at ${omega} rad/tick was ${gain.toFixed(3)}, expected within 10% of 1`
    );
  }
});

test("the ring holds a single bump and reports high certainty", () => {
  const brain = new DrosophilaBrain(1, "navigator");
  integrateHeading(brain, 0.2, 12);

  const ring = Array.from(brain.epgRing);
  const total = ring.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-4, "ring activity is normalised");
  assert.ok(brain.ringCertainty > 0.5, "a single bump must read out as a confident heading");

  // One bump, not several: walking the ring must cross from silent to active
  // exactly once, and activity must fall away monotonically from the peak.
  const n = ring.length;
  const active = ring.map(v => v > 0.02);
  assert.ok(active.some(Boolean) && !active.every(Boolean), "some but not all wedges are active");
  let onsets = 0;
  for (let i = 0; i < n; i++) {
    if (active[i] && !active[(i - 1 + n) % n]) onsets++;
  }
  assert.equal(onsets, 1, "activity must form a single contiguous bump, not scattered spikes");

  let peak = 0;
  for (let i = 1; i < n; i++) if (ring[i] > ring[peak]) peak = i;
  for (let step = 1; step < Math.floor(n / 2); step++) {
    const outward = ring[(peak + step) % n];
    const inward = ring[(peak + step - 1) % n];
    assert.ok(outward <= inward + 1e-6, "the bump must decay away from its peak");
  }
});

test("heading persists through ticks with no angular velocity", () => {
  const brain = new DrosophilaBrain(1, "navigator");
  integrateHeading(brain, 0.25, 10);
  const held = brain.compassHeading;
  for (let t = 0; t < 60; t++) brain.updateRingAttractor(0);
  assert.ok(
    Math.abs(angleDelta(brain.compassHeading, held)) < 0.15,
    "the bump must hold heading; small drift is expected, a reset is not"
  );
});

test("a celestial anchor corrects accumulated drift without teleporting the bump", () => {
  // Turning back and forth nets to zero rotation, so ground truth returns to
  // where it started while the discrete ring accumulates error.
  const wobble = (anchorGain, ticks = 300) => {
    const brain = new DrosophilaBrain(1, "navigator");
    let truth = 0;
    for (let t = 0; t < ticks; t++) {
      const omega = 0.22 * Math.sin(t * 0.37);
      truth += omega;
      brain.updateRingAttractor(omega, anchorGain > 0 ? truth : null, anchorGain);
    }
    return Math.abs(angleDelta(brain.compassHeading, truth));
  };

  const free = wobble(0);
  const anchored = wobble(0.045);
  assert.ok(free > 0.05, "the unanchored ring should accumulate measurable drift");
  assert.ok(
    anchored < free / 4,
    `anchoring should cut drift well below ${free.toFixed(3)} rad, got ${anchored.toFixed(3)}`
  );

  // A weak reference corrects drift; it does not drag the bump across the ring,
  // which is the point of an attractor rather than a lookup.
  const distant = new DrosophilaBrain(1, "navigator");
  for (let t = 0; t < 200; t++) distant.updateRingAttractor(0, Math.PI, 0.045);
  assert.ok(
    Math.abs(angleDelta(distant.compassHeading, Math.PI)) > 1.0,
    "a weak anchor must not jump the bump to the opposite side of the ring"
  );

  const nearby = new DrosophilaBrain(1, "navigator");
  for (let t = 0; t < 200; t++) nearby.updateRingAttractor(0, 0.6, 0.045);
  assert.ok(
    Math.abs(angleDelta(nearby.compassHeading, 0.6)) < 0.1,
    "a nearby reference must pull the bump onto it"
  );
});

test("heading is broadcast from the Central Complex without wrapping through the antipode", () => {
  // Averaging raw scalar headings near 0 and 2pi lands at pi, which is exactly
  // backwards. The broadcast path must not.
  const syncytium = new SixteenFlyBrainSyncytium(3);
  syncytium.brains[1].compassHeading = 0.05;
  for (let i = 0; i < syncytium.brainCount; i++) {
    if (i !== 1) syncytium.brains[i].compassHeading = 2 * Math.PI - 0.05;
  }
  syncytium.step(OBS(0.5, 0.5), 0, 0, 100);

  for (let i = 0; i < syncytium.brainCount; i++) {
    const error = Math.abs(angleDelta(syncytium.brains[i].compassHeading, syncytium.brains[1].compassHeading));
    assert.ok(error < 1.0, `brain ${i} drifted ${error.toFixed(2)} rad from the compass reference`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mushroom body gain control
// ─────────────────────────────────────────────────────────────────────────────
test("APL feedback keeps Kenyon-cell coding sparse and sparser as input grows", () => {
  const measure = scale => {
    const syncytium = new SixteenFlyBrainSyncytium(3);
    const obs = new Array(14).fill(0.2 * scale);
    obs[4] = 0.8;
    syncytium.step(obs, 0.05, 0, 100);
    return {
      sparsity: syncytium.brains[3].kcSparsity,
      apl: syncytium.brains[3].aplActivity
    };
  };

  const weak = measure(0.2);
  const mid = measure(1.0);
  const strong = measure(3.0);

  for (const [name, m] of [["weak", weak], ["mid", mid], ["strong", strong]]) {
    assert.ok(m.sparsity > 0 && m.sparsity <= 0.25, `${name} sparsity ${m.sparsity} out of range`);
    assert.ok(Number.isFinite(m.apl) && m.apl >= 0, `${name} APL activity must settle finitely`);
  }
  assert.ok(strong.apl > weak.apl, "stronger drive must recruit more APL inhibition");
  assert.ok(
    strong.sparsity < weak.sparsity,
    "inhibition must tighten the code as drive grows, rather than pinning a fixed fraction"
  );
});

test("the legacy top-k mode pins sparseness at a fixed fraction instead", () => {
  const measure = scale => {
    const syncytium = new SixteenFlyBrainSyncytium(3, "legacy");
    const obs = new Array(14).fill(0.2 * scale);
    obs[4] = 0.8;
    syncytium.step(obs, 0.05, 0, 100);
    return syncytium.brains[3].kcSparsity;
  };
  assert.equal(measure(0.2), measure(3.0), "top-k selection is input-independent by construction");
});

// ─────────────────────────────────────────────────────────────────────────────
// Dopamine-gated plasticity
// ─────────────────────────────────────────────────────────────────────────────
test("punishment depresses the KC->MBON synapses of the channel that was taken", () => {
  const syncytium = new SixteenFlyBrainSyncytium(31);
  syncytium.step(OBS(0.3, 0.7), 0.1, 0, 100);

  const brain = syncytium.brains[3];
  const taken = syncytium.lastActionIndex;
  assert.ok(taken >= 0 && taken < 4);
  const activeKc = Array.from(brain.kcActivations).findIndex(v => v > 0.01);
  assert.ok(activeKc >= 0, "at least one Kenyon cell must be active");

  const before = brain.kcToMbonWeights.slice();
  syncytium.applyReinforcement(0, 1.5, null);
  const after = brain.kcToMbonWeights;

  const row = activeKc * brain.MBON_COUNT;
  assert.ok(
    after[row + taken] < before[row + taken],
    "punishment must weaken the synapse that drove the punished action"
  );
  for (let m = 0; m < brain.MBON_COUNT; m++) {
    if (m === taken) continue;
    assert.ok(
      after[row + m] >= before[row + m] - Math.abs(before[row + taken] - after[row + taken]),
      "untaken channels must be depressed less than the taken one"
    );
  }
});

test("reward leaves the taken channel relatively stronger than its alternatives", () => {
  const syncytium = new SixteenFlyBrainSyncytium(31);
  syncytium.step(OBS(0.3, 0.7), 0.1, 0, 100);

  const brain = syncytium.brains[3];
  const taken = syncytium.lastActionIndex;
  const activeKc = Array.from(brain.kcActivations).findIndex(v => v > 0.01);
  const row = activeKc * brain.MBON_COUNT;

  const before = brain.kcToMbonWeights.slice();
  syncytium.applyReinforcement(1.6, 0, { x: 0.3, y: 0.7 });
  const after = brain.kcToMbonWeights;

  const takenGain = after[row + taken] - before[row + taken];
  for (let m = 0; m < brain.MBON_COUNT; m++) {
    if (m === taken) continue;
    assert.ok(
      takenGain > after[row + m] - before[row + m],
      "the rewarded channel must gain relative to the channels that were not taken"
    );
  }
});

test("depressed synapses recover toward baseline when dopamine is silent", () => {
  const syncytium = new SixteenFlyBrainSyncytium(31);
  syncytium.step(OBS(0.3, 0.7), 0.1, 0, 100);
  const brain = syncytium.brains[3];
  const activeKc = Array.from(brain.kcActivations).findIndex(v => v > 0.01);
  const row = activeKc * brain.MBON_COUNT + syncytium.lastActionIndex;

  for (let i = 0; i < 20; i++) syncytium.applyReinforcement(0, 1.5, null);
  const depressed = brain.kcToMbonWeights[row];
  assert.ok(depressed < DEFAULT_CONFIG.kcMbonBaseline, "repeated punishment must depress the synapse");

  for (let i = 0; i < 200; i++) {
    syncytium.step(OBS(0.3, 0.7), 0.1, 0, 100);
    syncytium.applyReinforcement(0, 0, null);
  }
  assert.ok(
    brain.kcToMbonWeights[row] > depressed,
    "with no dopamine the synapse must recover, which is this model's forgetting"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Presets and snapshots
// ─────────────────────────────────────────────────────────────────────────────
test("the legacy preset selects every pre-upgrade mechanism", () => {
  const upgraded = new SixteenFlyBrainSyncytium(1);
  const legacy = new SixteenFlyBrainSyncytium(1, "legacy");
  assert.deepEqual(
    [upgraded.config.compass, upgraded.config.mbInhibition, upgraded.config.plasticity],
    ["attractor", "apl", "dan-ltd"]
  );
  assert.deepEqual(
    [legacy.config.compass, legacy.config.mbInhibition, legacy.config.plasticity],
    ["kinematic", "topk", "hebbian"]
  );
  assert.equal(legacy.brains[0].config.compass, "kinematic", "brains must inherit the preset");
});

test("a partial override keeps the remaining defaults", () => {
  const syncytium = new SixteenFlyBrainSyncytium(1, { plasticity: "hebbian" });
  assert.equal(syncytium.config.plasticity, "hebbian");
  assert.equal(syncytium.config.compass, "attractor");
  assert.equal(syncytium.config.mbInhibition, "apl");
  assert.equal(syncytium.config.aplFeedbackGain, DEFAULT_CONFIG.aplFeedbackGain);
});

test("snapshots carry the mechanism selection, the ring state and every fly's registers", () => {
  const env = {
    agent1X: 3, agent1Y: 4, agent1Energy: 90,
    agent2X: 11, agent2Y: 15, agent2Energy: 140,
    agent3X: 18, agent3Y: 2, agent3Energy: 60
  };
  const live = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(606), 0.55);
  for (let t = 0; t < 12; t++) {
    env.agent1X = (env.agent1X + 1) % 20;
    env.agent2Y = (env.agent2Y + 1) % 20;
    live.resolveAgents(env, OBS(0.2, 0.3), OBS(0.6, 0.8), OBS(0.9, 0.1));
  }

  const parsed = JSON.parse(FlyBrainStateSerializer.serialize(live));
  assert.equal(parsed.version, "7.0.0");
  assert.equal(parsed.config.compass, "attractor");
  assert.equal(parsed.tickCount, 12);
  assert.deepEqual(Object.keys(parsed.egoStates).sort(), ["agent1", "agent2", "agent3"]);

  const restored = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(1, "legacy"), 0.1);
  FlyBrainStateSerializer.deserialize(restored, parsed);
  assert.equal(restored.syncytium.config.compass, "attractor", "the saved mechanism wins");
  assert.equal(restored.syncytium.tickCount, 12);

  for (const key of ["agent1", "agent2", "agent3"]) {
    assert.deepEqual(
      Array.from(restored.syncytium.egoStates.get(key)[1].arrays.epgRing),
      Array.from(live.syncytium.egoStates.get(key)[1].arrays.epgRing),
      `${key} must resume with its own compass bump`
    );
  }
});

test("a legacy snapshot resumes on the legacy circuit", () => {
  const legacy = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(7, "legacy"), 0.55);
  legacy.syncytium.step(OBS(0.5, 0.5), 0.2, 0, 100);
  const json = FlyBrainStateSerializer.serialize(legacy);

  const restored = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(1), 0.55);
  FlyBrainStateSerializer.deserialize(restored, json);
  assert.equal(restored.syncytium.config.compass, "kinematic");
  assert.equal(restored.syncytium.brains[1].config.mbInhibition, "topk");
  assert.equal(LEGACY_CONFIG.plasticity, "hebbian");
});
