const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SixteenFlyBrainSyncytium, TwentyTwoFlyBrainSyncytium, SPECIALIST_ROLES,
  MultiAgentGraphGraft, FlyBrainStateSerializer, PreTrainingEngine
} = require('../src/fly-brain-engine.js');

const obs = (x = 0.5, y = 0.5, threat = 0.1) => [x, y, 0.25, threat, 0.65, 0.5, 0, 1, 1, 0, 0, 0, 0.2, 0.1];
const environment = () => ({
  gridSize: 12, agent1X: 2, agent1Y: 3, agent2X: 8, agent2Y: 7, agent3X: 5, agent3Y: 8,
  agent1Energy: 100, agent2Energy: 100, agent3Energy: 100,
  environmentByAgent: {
    agent1: { windX: 0.6, windY: -0.2, temperature: 34, humidity: 0.2, waterBearing: 0, waterProximity: 0.7 },
    agent2: { windX: -0.5, windY: 0.3, temperature: 16, humidity: 0.8, predatorBearing: 1, predatorProximity: 0.2 },
    agent3: { windX: 0, windY: -0.8, temperature: 24, humidity: 0.6 }
  }
});
function advance(graft, env) {
  const inputs = [1, 2, 3].map(id => obs(env[`agent${id}X`] / 11, env[`agent${id}Y`] / 11));
  const result = graft.resolveAgents(env, ...inputs);
  for (const id of [1, 2, 3]) {
    const action = result[`agent${id}`].actionIndex;
    env[`agent${id}X`] += [0, 0, -1, 1][action];
    env[`agent${id}Y`] += [-1, 1, 0, 0][action];
    graft.feedback(id === 1 ? 0.8 : 0, false,
      { x: env[`agent${id}X`] / 11, y: env[`agent${id}Y`] / 11 }, `agent${id}`);
  }
  return result;
}

test('22 circuits retain all baseline roles and expose actual normalized dense edge counts', () => {
  const baseline = new SixteenFlyBrainSyncytium(7);
  const sync = new TwentyTwoFlyBrainSyncytium(7);
  assert.equal(baseline.brainCount, 16);
  assert.deepEqual(sync.roles.slice(0, 16), baseline.roles);
  assert.deepEqual(sync.roles.slice(16), SPECIALIST_ROLES);
  assert.equal(sync.commissuralWeights.length, 22 * 22 * 4);
  assert.deepEqual(sync.getTelemetry().graph, {
    directedPairs: 462, actionSynapses: 1848, density: 1, couplingStrength: 0.8, normalized: true
  });
  for (const strength of [0, 0.8, 2]) {
    assert.equal(sync.setCouplingStrength(strength), true);
    for (let destination = 0; destination < 22; destination++) {
      for (let action = 0; action < 4; action++) {
        let total = 0;
        for (let source = 0; source < 22; source++) total += sync.commissuralWeights[(source * 22 + destination) * 4 + action];
        assert.ok(Math.abs(total - strength) < 1e-6);
      }
    }
    const probabilities = sync.step(obs());
    assert.ok(probabilities.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  }
  assert.equal(sync.setCouplingStrength(NaN), false);
  assert.equal(sync.setCouplingStrength(3), false);
});

test('specialists respond to plume, climate, forecast, repeated routes, uncertainty and peer spacing', () => {
  const sync = new TwentyTwoFlyBrainSyncytium(2);
  const scores = role => sync.brains.find(brain => brain.role === role).descendingOutputs;
  const observation = obs(0.5, 0.5, 0.8);
  observation.environment = { windX: -1, temperature: 38, humidity: 0, refugeBearing: 0, refugeProximity: 1 };
  sync.step(observation, 0, 0, 80, { dist: 1, dx: 1, dy: 0 }, 'agent1');
  assert.ok(scores('plume')[3] > scores('plume')[2], 'upwind plume integration favours right');
  assert.ok(scores('climate')[3] > scores('climate')[2], 'heat favours the supplied refuge bearing');
  assert.ok(scores('threat_forecast')[0] > scores('threat_forecast')[1], 'rising threat below favours up');
  assert.ok(scores('social')[2] > scores('social')[3], 'nearby peer on the right evokes spacing left');
  const quiet = obs(); quiet[2] = 0; quiet[3] = 0;
  sync.step(quiet, 0, 0, 80, null, 'agent1');
  assert.ok(sync.getTelemetry().specialists.uncertainty > 0);
  const route = sync.brains.find(brain => brain.role === 'route_memory');
  route.specialistMemory[8 + 8 * 16 + 9] = 240;
  sync.saveEgo('agent1');
  sync.step(quiet, 0, 0, 80, null, 'agent1');
  assert.ok(scores('route_memory')[2] > scores('route_memory')[3], 'repeated route is less attractive');
});

test('specialist temporal state and visits are isolated between agent egos', () => {
  const sync = new TwentyTwoFlyBrainSyncytium(3);
  sync.step(obs(0.2, 0.2, 0.9), 0, 0, 100, null, 'agent1');
  const original = Array.from(sync.egoStates.get('agent1')[18].arrays.specialistMemory);
  sync.step(obs(0.8, 0.8, 0), 0, 0, 100, null, 'agent2');
  assert.deepEqual(Array.from(sync.egoStates.get('agent1')[18].arrays.specialistMemory), original);
  assert.equal(sync.egoStates.get('agent2')[18].arrays.specialistMemory[0], 0);
});

test('advice validates every agent vector, bounds influence and expires in simulation ticks', () => {
  const graft = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(4));
  const packet = { tick: 0, ttl: 2, influence: 0.35, agents: { agent1: [0, 0, 0, 1] }, source: 'test', model: 'bounded' };
  assert.equal(graft.setExternalAdvice(packet), true);
  packet.agents.agent1[3] = -1;
  graft.syncytium.tickCount = 1;
  assert.deepEqual(graft._advise([0, 0, 0, 0], 'agent1', obs()), [0, 0, 0, 0.315]);
  assert.deepEqual(graft._advise([0, 0, 0, 0], 'agent2', obs()), [0, 0, 0, 0]);
  assert.deepEqual(graft._advise([0, 0, 0, 0], 'agent1', obs(0.5, 0.5, 1)), [0, 0, 0, 0]);
  graft.syncytium.tickCount = 3;
  assert.deepEqual(graft._advise([0, 0, 0, 0], 'agent1', obs()), [0, 0, 0, 0]);
  assert.equal(graft.externalAdvice, null);
  for (const change of [
    { tick: 4 }, { tick: -1 }, { ttl: 31 }, { ttl: 1.5 }, { influence: 0.36 },
    { agents: { agent1: [0, Infinity, 0, 1] } }, { agents: { agent1: [0, 0, 2, 0] } },
    { agents: { agent1: [0, 0, 1] } }, { agents: { agent4: [0, 0, 0, 1] } }, { agents: {} }
  ]) {
    assert.equal(graft.setExternalAdvice({ ...packet, tick: 3, ...change }), false);
    assert.equal(graft.externalAdvice, null);
  }
});

test('advice is consulted before wall filtering and cannot force illegal motion', () => {
  const graft = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(5), 0);
  graft.syncytium.step = function() { return [0.25, 0.25, 0.25, 0.25]; };
  const env = environment();
  env.walls = [{ x: 3, y: 3 }];
  graft.setExternalAdvice({ tick: 0, ttl: 1, influence: 0.35, agents: { agent1: [-1, -1, 0.5, 1] } });
  const result = graft.resolveAgents(env, obs(), obs());
  assert.equal(result.agent1.actionIndex, 2, 'right scores highest but wall forces legal left');
  assert.equal(graft.lastAdviceReceipt.appliedTick, 1);
  graft.clearExternalAdvice();
  assert.equal(graft.externalAdvice, null);
});

test('new mode releases stale commitments when current state clearly favours another action', () => {
  const graft = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(6));
  graft.agent1.committedAction = 3;
  assert.equal(graft._holdCommitment(graft.agent1, [0.8, 0.1, 0.05, 0.05]), false);
  assert.equal(graft._holdCommitment(graft.agent1, [0.25, 0.25, 0.25, 0.25]), true);
  graft.agent1.isStasisHazard = true;
  assert.equal(graft._holdCommitment(graft.agent1, [0.25, 0.25, 0.25, 0.25]), false);
});

test('v8 snapshot replays pretrained tri-agent actions, body memory, weights and tick-bound advice exactly', () => {
  const live = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(9));
  PreTrainingEngine.runPreTraining(live.syncytium, 5);
  const env = environment();
  for (let i = 0; i < 5; i++) advance(live, env);
  live.setExternalAdvice({ tick: live.syncytium.tickCount, ttl: 4, influence: 0.2,
    agents: { agent1: [0, 0, 0, 1], agent3: [1, 0, 0, 0] }, source: 'replay-fixture' });
  const snapshot = FlyBrainStateSerializer.serialize(live, { env });
  const replay = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(99));
  const identity = replay.syncytium;
  const restored = FlyBrainStateSerializer.deserialize(replay, snapshot);
  assert.equal(replay.syncytium, identity, 'preserve caller-held identity after atomic restore');
  for (let i = 0; i < 8; i++) assert.deepEqual(advance(replay, restored.env), advance(live, env));
  assert.deepEqual(restored.env, env);
  for (let i = 0; i < 22; i++) {
    assert.deepEqual(replay.syncytium.brains[i].kcToMbonWeights, live.syncytium.brains[i].kcToMbonWeights);
    assert.deepEqual(replay.syncytium.brains[i].alToKcWeights, live.syncytium.brains[i].alToKcWeights);
    assert.deepEqual(replay.syncytium.brains[i].specialistMemory, live.syncytium.brains[i].specialistMemory);
  }
  const stateOf = graft => {
    const state = JSON.parse(FlyBrainStateSerializer.serialize(graft));
    delete state.timestamp;
    return state;
  };
  assert.deepEqual(stateOf(replay), stateOf(live), 'full continuation snapshots including PRNG accumulators match');
});

test('v8 rejects corrupt shapes, non-finite data, mismatched roles and unnormalized coupling atomically', () => {
  const graft = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(11));
  const clean = JSON.parse(FlyBrainStateSerializer.serialize(graft));
  const before = () => { const data = JSON.parse(FlyBrainStateSerializer.serialize(graft)); delete data.timestamp; return data; };
  const original = before();
  for (const corrupt of [
    data => data.brains.pop(), data => data.roles.reverse(),
    data => data.commissuralWeights[4] = 12,
    data => data.exactState.alToKcWeights[0].pop(),
    data => data.exactState.brainEgos[16].arrays.specialistMemory.pop(),
    data => data.exactState.graftAgents[1].lastX = Infinity,
    data => data.config.ringRate = 'not-a-number',
    data => data.graftInfluence = '0.5',
    data => data.exactState.egoValues = [['agent1', 'bad-estimate']],
    data => data.exactState.brainEgos[0].arrays.alProjection[0] = 1e100,
    data => data.brains[0].kcToMbonWeights[0] = 'oops'
  ]) {
    const data = structuredClone(clean); corrupt(data);
    assert.throws(() => FlyBrainStateSerializer.deserialize(graft, data), /Invalid 22-brain snapshot/);
    assert.deepEqual(before(), original);
  }
  const baseline = new MultiAgentGraphGraft(new SixteenFlyBrainSyncytium(11));
  assert.throws(() => FlyBrainStateSerializer.deserialize(baseline, clean), /22-brain/);
  assert.throws(() => FlyBrainStateSerializer.deserialize(graft, FlyBrainStateSerializer.serialize(baseline)), /Legacy/);
});

test('restored state owns its imported data rather than aliasing caller objects', () => {
  const graft = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(12));
  graft.feedback(1, false, { x: 0.3, y: 0.8 });
  const data = JSON.parse(FlyBrainStateSerializer.serialize(graft));
  const replay = new MultiAgentGraphGraft(new TwentyTwoFlyBrainSyncytium(13));
  FlyBrainStateSerializer.deserialize(replay, data);
  data.engramBank[0].targetX = 99;
  data.exactState.graftAgents[0].lastFlyProbabilities[0] = 99;
  assert.equal(replay.syncytium.engramBank[0].targetX, 0.3);
  assert.notEqual(replay.agent1.lastFlyProbabilities[0], 99);
});
