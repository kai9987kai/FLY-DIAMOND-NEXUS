const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FlyEnvironment } = require('../src/fly-environment.js');
const world = () => ({agent1X: 2, agent1Y: 2, agent2X: 15, agent2Y: 15, agent3X: 8, agent3Y: 8, diamonds: [{x: 4, y: 4}], hazards: []});

test('weather, regrowth and predators replay exactly across a snapshot', () => {
  const a = new FlyEnvironment(42), envA = world(); a.seedTerrain(envA); a.setPreset('storm');
  for (let i = 0; i < 47; i++) a.step(envA);
  const b = FlyEnvironment.restore(JSON.parse(JSON.stringify(a.snapshot())));
  const envB = JSON.parse(JSON.stringify(envA)); b.attach(envB);
  for (let i = 0; i < 200; i++) { a.step(envA); b.step(envB); }
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(envA, envB);
});
test('a fresh environment round-trips before any weather tick', () => {
  const climate = new FlyEnvironment(2077), restored = FlyEnvironment.restore(climate.snapshot());
  assert.deepEqual(restored.snapshot(), climate.snapshot());
  assert.deepEqual(restored.sense(1, 1, world()), climate.sense(1, 1, world()));
});
test('unknown imported fields cannot replace environment methods', () => {
  const snapshot = new FlyEnvironment(5).snapshot();
  assert.throws(() => FlyEnvironment.restore({ ...snapshot, random: 0 }), /Unknown/);
  assert.throws(() => FlyEnvironment.restore({ ...snapshot, brush: null }), /Unknown/);
});
test('wall brush protects each fly and its exits, deduplicates and erases terrain', () => {
  const climate = new FlyEnvironment(10), env = world();
  climate.brush(env, 'wall', 2, 2, 3, 2);
  for (const [dx, dy] of [[0,0], [0,1], [0,-1], [1,0], [-1,0]]) assert.equal(climate.isBlocked(2+dx, 2+dy), false);
  const count = climate.walls.length;
  climate.brush(env, 'wall', 2, 2, 3, 2); assert.equal(climate.walls.length, count);
  climate.brush(env, 'erase', 2, 2, 4); assert.equal(climate.walls.length, 0);
  climate.brush(env, 'food', 5, 5); climate.brush(env, 'food', 5, 5); assert.equal(env.diamonds.filter(p => p.x === 5 && p.y === 5).length, 1);
});
test('weather and terrain affect energy costs and sensory observations', () => {
  const climate = new FlyEnvironment(8), env = world();
  climate.setPreset('calm'); const base = climate.movementCost(2, 2, 1, 0);
  climate.setPreset('drought'); assert.ok(climate.movementCost(2, 2, -1, 0) > base);
  assert.ok(climate.movementCost(2, 2, -1, 0) > climate.movementCost(2, 2, 1, 0));
  climate.brush(env, 'water', 2, 2); assert.ok(climate.movementCost(2, 2, 1, 0) < climate.movementCost(3, 2, 1, 0));
  climate.brush(env, 'predator', 4, 2); const sensed = climate.sense(2, 2, env);
  assert.equal(sensed.predatorBearing, 0); assert.ok(sensed.predatorProximity > 0.5); assert.equal(sensed.inWater, true);
  climate.brush(env, 'refuge', 4, 2); assert.equal(climate.predators.length, 0); assert.equal(climate.predatorDamage(4, 2), 0);
});
test('resource placement stays bounded in a fully occupied arena', () => {
  const climate = new FlyEnvironment(1, 4), env = world(); env.diamonds = []; env.hazards = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) climate.walls.push({x, y, strength: 1});
  climate.setVariable('resourceRegrowth', 1); climate.setVariable('humidity', 1);
  for (let i = 0; i < 100; i++) climate.step(env);
  assert.equal(env.diamonds.length, 0);
});
test('zero resource regrowth keeps a depleted arena empty', () => {
  const climate = new FlyEnvironment(1), env = world(); env.diamonds = [];
  climate.setVariable('resourceRegrowth', 0);
  for (let i = 0; i < 300; i++) climate.step(env);
  assert.equal(env.diamonds.length, 0); assert.equal(climate.resourcesGrown, 0);
});
test('invalid snapshot state is rejected without changing active state', () => {
  const climate = new FlyEnvironment(10); const state = climate.snapshot();
  for (const mutate of [s => s.rngState = -1, s => s.weather.humidity = NaN, s => s.walls = [{x: -1, y: 0, strength: 1}], s => s.dynamic = 'yes']) {
    const invalid = structuredClone(state); mutate(invalid); assert.throws(() => FlyEnvironment.restore(invalid));
  }
  assert.deepEqual(climate.snapshot(), state);
});
