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
