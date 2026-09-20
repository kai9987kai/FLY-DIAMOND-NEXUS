'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBridge, createBridgeHandler, localEndpoint, readTelemetry, validateObservation, validateAdvice } = require('../scripts/supermix-bridge.cjs');

const observation = { tick: 10, agents: { agent1: { x: 4, y: 5, energy: 0.8 } }, world: { width: 20, height: 20 } };
const health = { model: 'v91-C-control', loaded: true, noLoad: true, inferenceOnly: true };
const advice = { model: 'v91-C-control', source: 'model', agents: { agent1: [0.1, -0.2, 0, 1] } };

async function fixture(t, handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ route: req.url, method: req.method, body: body ? JSON.parse(body) : null });
    handler(req, res, calls);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, calls };
}

function reply(res, payload, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); }

test('endpoint configuration accepts literal loopback origins only', () => {
  for (const value of ['http://example.com', 'https://127.0.0.1:44', 'http://127.0.0.1:12/api/chat', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/?file=a', 'http://127.0.0.1/#a']) {
    assert.throws(() => localEndpoint(value));
  }
  assert.equal(localEndpoint('http://localhost:8092').hostname, '127.0.0.1');
  assert.equal(localEndpoint('http://[::1]:8092').hostname, '[::1]');
});

test('unconfigured bridge never labels telemetry as model inference', async () => {
  const bridge = createBridge({ env: {}, root: null, adapter: 'no-load', endpoint: '' });
  const status = await bridge.status();
  assert.equal(status.mode, 'unavailable');
  assert.equal(status.inference.ready, false);
  assert.equal(status.inference.verifiedModel, null);
  assert.equal(status.safety.loadsCheckpoints, false);
  await assert.rejects(bridge.advice(observation), { code: 'inference_unconfigured' });
});

test('telemetry reads bounded fixed logs and marks launch scripts as prepared only', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diamond-supermix-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'output/v92_connectome');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'run_v92.sh'), 'python train.py');
  let result = await readTelemetry(root, Date.now());
  assert.equal(result.state, 'prepared');
  assert.match(result.message, /unverified/);
  await fs.writeFile(path.join(directory, 'v92.log'), 'x'.repeat(40000) + '\nstep 42/8000 train_loss=1.25\n');
  result = await readTelemetry(root, Date.now());
  assert.equal(result.state, 'log-updating');
  assert.deepEqual(result.metrics, { step: 42, totalSteps: 8000, loss: 1.25 });
  assert.equal(result.text, undefined);
  await fs.appendFile(path.join(directory, 'v92.log'), 'v92 done\n');
  result = await readTelemetry(root, Date.now());
  assert.equal(result.state, 'log-complete');
  assert.match(result.message, /not model promotion/);
});

test('service must report already resident v92 and a no-load inference contract', async t => {
  for (const badHealth of [{ model: 'v89', loaded: true }, { ...health, loaded: false }, { ...health, noLoad: false }, { ...health, inferenceOnly: false }, { status: 'ok', models: ['v92'] }]) {
    const service = await fixture(t, (req, res) => reply(res, badHealth));
    const bridge = createBridge({ ...service, env: {}, root: null, adapter: 'no-load' });
    const status = await bridge.status();
    assert.equal(status.inference.ready, false);
    await assert.rejects(bridge.advice(observation), { code: 'identity_unverified' });
    assert.ok(service.calls.every(call => call.route === '/health'));
  }
});

test('validated model advice is bounded and tied to the requesting simulation tick', async t => {
  const service = await fixture(t, (req, res) => reply(res, req.url === '/health' ? health : { ...advice, tick: 999999, ttl: 1000, influence: 1 }));
  const bridge = createBridge({ ...service, env: {}, root: null, adapter: 'no-load' });
  assert.equal((await bridge.status()).mode, 'inference-ready');
  const result = await bridge.advice({ ...observation, endpoint: 'http://example.com', path: '/secret' });
  assert.deepEqual(result, { schemaVersion: 1, source: 'model', model: 'v91-C-control', advice: { tick: 10, ttl: 30, influence: 0.2, agents: advice.agents } });
  const sent = service.calls.find(call => call.route === '/advice').body;
  assert.deepEqual(sent.observation, observation);
  assert.equal(sent.noLoad, true);
  assert.deepEqual(sent.actionOrder, ['up', 'down', 'left', 'right']);
  await assert.rejects(bridge.advice(observation), { code: 'rate_limited', status: 429 });
});

test('invalid model action vectors and mismatched identities fail closed', () => {
  for (const payload of [
    { ...advice, model: 'v93' }, { ...advice, source: 'heuristic' },
    { ...advice, agents: {} }, { ...advice, agents: { ...advice.agents, agent2: [0, 0, 0, 0] } },
    { ...advice, agents: { agent1: [1, 2, 3, 4] } }, { ...advice, agents: { agent1: [0, 0, 0] } },
    { ...advice, agents: { agent1: [0, NaN, 0, 0] } }, { ...advice, agents: { agent1: [0, '0', 0, 0] } },
  ]) assert.throws(() => validateAdvice(payload, observation));
});

test('observations cannot inject file paths, service URLs, arbitrary agents, or unbounded data', () => {
  assert.deepEqual(validateObservation({ ...observation, endpoint: 'http://example.com', path: 'secret' }), observation);
  for (const input of [
    { ...observation, tick: -1 }, { ...observation, agents: { attacker: { x: 1, y: 2 } } },
    { ...observation, agents: { agent1: { x: Infinity, y: 2 } } },
    { ...observation, world: { data: 'x'.repeat(81) } },
    { ...observation, world: { data: Array(100).fill(1) } },
    { ...observation, world: JSON.parse('{"__proto__":{"x":1}}') },
  ]) assert.throws(() => validateObservation(input));
});

test('health and generation failures open a cooldown circuit', async t => {
  let time = 100000;
  const service = await fixture(t, (req, res) => reply(res, {}, 503));
  const bridge = createBridge({ ...service, env: {}, root: null, adapter: 'no-load', now: () => time, cacheMs: 0 });
  for (let i = 0; i < 3; i++) { await bridge.status(); time += 10000; }
  assert.equal(service.calls.length, 3);
  const cooling = await bridge.status();
  assert.equal(service.calls.length, 3);
  assert.match(cooling.inference.reason, /cooling down/);
  await assert.rejects(bridge.advice(observation), { code: 'circuit_open' });
  time += 60000;
  await bridge.status();
  assert.equal(service.calls.length, 4);
});

test('slow generation is aborted and cannot produce stale advice', async t => {
  const service = await fixture(t, (req, res) => { if (req.url === '/health') reply(res, health); });
  const bridge = createBridge({ ...service, env: {}, root: null, adapter: 'no-load', timeoutMs: 40 });
  await assert.rejects(bridge.advice(observation), { code: 'timeout' });
});

test('status is cached and concurrent advice is refused', async t => {
  let pending;
  const service = await fixture(t, (req, res) => {
    if (req.url === '/health') reply(res, health);
    else pending = res;
  });
  const bridge = createBridge({ ...service, env: {}, root: null, adapter: 'no-load' });
  await Promise.all([bridge.status(), bridge.status(), bridge.status()]);
  await bridge.status();
  assert.equal(service.calls.length, 1);
  const first = bridge.advice(observation);
  await assert.rejects(bridge.advice(observation), { code: 'rate_limited' });
  for (let i = 0; !pending && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.ok(pending);
  reply(pending, advice);
  await first;
});

test('redirects are rejected without contacting another endpoint', async t => {
  const service = await fixture(t, (req, res) => { res.writeHead(302, { Location: 'http://example.com' }); res.end(); });
  const bridge = createBridge({ ...service, env: {}, root: null, adapter: 'no-load' });
  await assert.rejects(bridge.advice(observation), { code: 'service_unavailable' });
  assert.equal(service.calls.length, 1);
});

test('HTTP handler requires local same-origin JSON and exposes no proxy route', async t => {
  const handler = createBridgeHandler({ env: {}, root: null, adapter: 'no-load', endpoint: '' });
  const server = http.createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${origin}/api/supermix/status`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).inference.ready, false);
  response = await fetch(`${origin}/api/supermix/status`, { headers: { Origin: 'https://example.com' } });
  assert.equal(response.status, 403);
  // Node fetch replaces Host; use a raw HTTP client to exercise DNS-rebinding rejection.
  const hostileStatus = await new Promise((resolve, reject) => {
    http.get(`${origin}/api/supermix/status`, { headers: { Host: 'attacker.invalid' } }, result => { result.resume(); resolve(result.statusCode); }).on('error', reject);
  });
  assert.equal(hostileStatus, 403);
  response = await fetch(`${origin}/api/supermix/advice`, { method: 'POST', body: JSON.stringify(observation) });
  assert.equal(response.status, 415);
  response = await fetch(`${origin}/api/supermix/advice`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(observation) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'inference_unconfigured');
  response = await fetch(`${origin}/api/supermix/proxy?url=http://example.com`);
  assert.equal(response.status, 404);
});

test('native adapter admits only the already resident observed v91 control checkpoint', async t => {
  for (const entry of [
    { name: 'v91-C-control', resident: false, checkpoint: 'output/v91_control/v91_control.pt' },
    { name: 'v91-A-connectome', resident: true, checkpoint: 'output/v91_cns_connectome/v91_cns_connectome.pt' },
    { name: 'v91-C-control', resident: true, checkpoint: 'output/another/model.pt' },
  ]) {
    const service = await fixture(t, (req, res) => reply(res, { models: [entry] }));
    const bridge = createBridge({ ...service, env: {}, root: null, adapter: 'native' });
    await assert.rejects(bridge.advice(observation));
    assert.deepEqual(service.calls.map(call => call.route), ['/api/models']);
  }
});

test('native adapter uses a stateless single-model bounded request and exact named directions', async t => {
  const service = await fixture(t, (req, res) => reply(res, req.url === '/api/models'
    ? { models: [{ name: 'v91-C-control', resident: true, checkpoint: 'output/v91_control/v91_control.pt' }] }
    : { results: [{ model: 'v91-C-control', reply: '{"agent1":"left"}' }] }));
  const bridge = createBridge({ ...service, env: {}, root: null });
  const status = await bridge.status();
  assert.equal(status.targetModel, 'v91');
  assert.equal(status.inference.verifiedModel, 'v91-C-control');
  assert.equal(status.safety.residencyCheck, 'best-effort');
  const result = await bridge.advice(observation);
  assert.deepEqual(result.advice.agents.agent1, [0, 0, 1, 0]);
  assert.equal(result.model, 'v91-C-control');
  assert.deepEqual(service.calls.map(call => call.route), ['/api/models', '/api/models', '/api/compare']);
  const payload = service.calls[2].body;
  assert.equal(payload.model, 'v91-C-control');
  assert.deepEqual(payload.models, ['v91-C-control']);
  assert.equal(payload.max_new_tokens, 64);
  assert.equal(payload.check, false);
  assert.equal(payload.mode, 'greedy');
  assert.equal(payload.session_id, undefined);
});

test('native prose is rejected rather than interpreted as model action advice', async t => {
  const service = await fixture(t, (req, res) => reply(res, req.url === '/api/models'
    ? { models: [{ name: 'v91-C-control', resident: true, checkpoint: 'output/v91_control/v91_control.pt' }] }
    : { results: [{ model: 'v91-C-control', reply: 'The answer is 42. Go left.' }] }));
  const bridge = createBridge({ ...service, env: {}, root: null });
  await assert.rejects(bridge.advice(observation), { code: 'invalid_model_reply' });
  const status = await bridge.status();
  assert.equal(status.inference.lastAdviceError.code, 'invalid_model_reply');
});
