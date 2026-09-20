'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/fly-supermix-client.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture({ready = false, delayed = false} = {}) {
  const elements = new Map();
  for (const id of ['supermixPanel', 'supermixMode', 'supermixTraining', 'supermixAdvice', 'supermixEnabled', 'supermixRefresh']) {
    elements.set(id, {textContent: '', innerHTML: '', checked: true, events: {}, addEventListener(event, fn) {this.events[event] = fn;}});
  }
  const calls = [], accepted = [];
  let tick = 0, clock = 100, resolveAdvice;
  const graft = {setExternalAdvice(value) {accepted.push(value); return true;}, clearExternalAdvice() {accepted.push(null);}};
  const lab = {env: {seed: 47, gridSize: 20}, graft, running: true, telemetry: () => ({tick}),
    observation: () => ({tick, agents: {agent1: {x: 2, y: 3}}, world: {seed: 47, gridSize: 20}})};
  const receipt = {source: 'model', model: 'v92', advice: {tick: 0, ttl: 30, influence: 0.2, agents: {agent1: [0, 1, 0, 0]}}};
  const response = value => ({ok: true, json: async () => value});
  const context = {document: {hidden: false, getElementById: id => elements.get(id)}, flyLab: lab,
    location: {protocol: 'http:'}, performance: {now: () => clock}, AbortController,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, addEventListener() {},
    fetch: async (url, options) => {
      calls.push({url, body: options.body ? JSON.parse(options.body) : null});
      if (url.endsWith('/status')) return response({mode: ready ? 'inference-ready' : 'telemetry-only',
        training: {state: 'prepared', message: 'No active v92 evidence.'}, inference: {ready, verifiedModel: ready ? 'v92' : null}});
      if (delayed) return new Promise(resolve => {resolveAdvice = value => resolve(response(value || receipt));});
      return response(receipt);
    }};
  vm.runInNewContext(source, context);
  return {context, lab, elements, calls, accepted, tick: n => {tick = n;}, clock: n => {clock = n;}, finish: value => resolveAdvice(value)};
}
test('telemetry-only connection never submits model inference', async () => {
  const f = fixture(); await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.accepted.length, 0);
  assert.match(f.elements.get('supermixMode').textContent, /telemetry only/);
});
test('verified model advice keeps original observation tick and is rate limited', async () => {
  const f = fixture({ready: true}); await flush();
  assert.equal(f.accepted[0].tick, 0);
  assert.equal(f.context.flySupermix.counters.applied, 1);
  await f.context.flySupermix.poll();
  assert.equal(f.calls.filter(c => c.url.endsWith('/advice')).length, 1);
  f.elements.get('supermixEnabled').checked = false;
  f.elements.get('supermixEnabled').events.change();
  assert.equal(f.accepted.at(-1), null);
});
test('network delay cannot refresh expired advice', async () => {
  const f = fixture({ready: true, delayed: true}); await flush();
  f.tick(31); f.finish(); await flush();
  assert.equal(f.accepted.length, 0);
  assert.equal(f.context.flySupermix.counters.stale, 1);
});
test('reset while inference is pending discards response for the previous run', async () => {
  const f = fixture({ready: true, delayed: true}); await flush();
  f.lab.graft = {setExternalAdvice() {throw new Error('old advice must not be injected');}};
  f.finish(); await flush();
  assert.equal(f.accepted.length, 0);
  assert.equal(f.context.flySupermix.counters.stale, 1);
});
test('response from a different model is never attributed to v92', async () => {
  const f = fixture({ready: true, delayed: true}); await flush();
  f.finish({source: 'model', model: 'v91', advice: {tick: 0}}); await flush();
  assert.equal(f.accepted.length, 0);
});
