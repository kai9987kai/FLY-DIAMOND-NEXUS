// Read-only telemetry and a bounded adapter to an ALREADY resident inference service.
// This module never imports Supermix, loads checkpoints, or starts/stops processes.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

const SCHEMA_VERSION = 1;
const TARGET_MODEL = 'v92';
const AGENTS = ['agent1', 'agent2', 'agent3'];
const TELEMETRY_FILES = [
  ['v92', 'output/v92_connectome/v92.log'],
  ['v92-launch', 'output/v92_connectome/run_v92.sh'],
  ['v93-chain', 'output/v93_neurogenesis/chain.log'],
  ['v93-training', 'output/v93_neurogenesis/train.log'],
  ['v91-analysis', 'output/v91_malecns/analysis.log'],
];

class BridgeError extends Error {
  constructor(code, reason, status = 503) { super(reason); this.code = code; this.status = status; }
}

function localEndpoint(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SUPERMIX_ENDPOINT must be a plain HTTP loopback origin, for example http://127.0.0.1:8092');
  }
  // Resolve localhost to a literal address: no DNS or redirects can change the target.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}

function requestJSON(origin, route, method, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const request = http.request(new URL(route, origin), {
      method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, response => {
      let count = 0;
      const chunks = [];
      response.on('data', chunk => {
        count += chunk.length;
        if (count > 32768) { response.destroy(); request.destroy(new BridgeError('response_too_large', 'Inference response exceeded the size limit.')); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new BridgeError('service_unavailable', 'The configured inference service is unavailable.'));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new BridgeError('invalid_response', 'The inference service returned invalid JSON.')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new BridgeError('timeout', 'The inference service timed out.')), timeoutMs);
    request.once('close', () => clearTimeout(timer));
    request.on('error', error => reject(error instanceof BridgeError ? error : new BridgeError('service_unavailable', 'The configured inference service is unavailable.')));
    if (body) request.write(body);
    request.end();
  });
}

async function tailFile(file, limit = 16384) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a file');
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, stat.size - buffer.length));
    return { modifiedAt: stat.mtime.toISOString(), bytes: stat.size, text: buffer.subarray(0, bytesRead).toString('utf8') };
  } finally { await handle.close(); }
}

function extractMetrics(text) {
  const lines = text.split(/\r?\n/).reverse();
  let step = null, totalSteps = null, loss = null;
  for (const line of lines) {
    if (step === null) {
      const match = line.match(/(?:step\s*[=:]?\s*)?(\d+)\s*\/\s*(\d+)/i) || line.match(/\bstep\s*[=:]\s*(\d+)/i);
      if (match) { step = Number(match[1]); totalSteps = match[2] ? Number(match[2]) : null; }
    }
    if (loss === null) {
      const match = line.match(/\b(?:train_)?loss\s*[=:]\s*([0-9]+(?:\.[0-9]+)?(?:e[+-]?\d+)?)/i);
      if (match && Number.isFinite(Number(match[1]))) loss = Number(match[1]);
    }
    if (step !== null && loss !== null) break;
  }
  return { step, totalSteps, loss };
}

async function readTelemetry(root, now) {
  if (!root) return { state: 'unavailable', phase: 'unknown', lastUpdate: null, metrics: extractMetrics(''), message: 'No Supermix directory is configured.', activity: [] };
  const found = await Promise.all(TELEMETRY_FILES.map(async ([id, relative]) => {
    try { return { id, ...(await tailFile(path.join(root, relative))) }; }
    catch { return null; }
  }));
  const log = found.find(item => item?.id === 'v92');
  const prepared = found.some(item => item?.id === 'v92-launch');
  const activity = found.filter(item => item && !['v92', 'v92-launch'].includes(item.id)).map(item => ({
    source: item.id, modifiedAt: item.modifiedAt, recent: now - Date.parse(item.modifiedAt) < 120000,
  }));
  if (!log) return {
    state: prepared ? 'prepared' : 'unavailable', phase: prepared ? 'awaiting-evidence' : 'unknown',
    lastUpdate: null, metrics: extractMetrics(''), activity,
    message: prepared ? 'v92 launch script found; no v92 run log. Active v92 training is unverified.' : 'No v92 telemetry found. Active v92 training is unverified.',
  };
  const recent = now - Date.parse(log.modifiedAt) < 120000;
  const completed = /\bv92 done\b/i.test(log.text);
  return {
    state: completed ? 'log-complete' : recent ? 'log-updating' : 'idle',
    phase: completed ? 'run-ended' : 'log-observed', lastUpdate: log.modifiedAt,
    metrics: extractMetrics(log.text), activity,
    message: completed ? 'v92 log records a finished run; this is not model promotion or an inference identity.'
      : recent ? 'Recent v92 log activity observed; process liveness and successful training are unverified.'
        : 'v92 log is not recent; active training is unverified.',
  };
}

function boundedData(value, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 450 || depth > 5) throw new BridgeError('invalid_observation', 'Observation is too complex.', 400);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9) return value;
  if (typeof value === 'string' && value.length <= 80) return value;
  if (Array.isArray(value) && value.length <= 64) return value.map(item => boundedData(item, depth + 1, budget));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value);
    if (keys.length > 40 || keys.some(key => !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key))) {
      throw new BridgeError('invalid_observation', 'Observation contains unsupported fields.', 400);
    }
    return Object.fromEntries(keys.map(key => [key, boundedData(value[key], depth + 1, budget)]));
  }
  throw new BridgeError('invalid_observation', 'Observation values must be small finite JSON data.', 400);
}

function validateObservation(input) {
  if (!input || !Number.isSafeInteger(input.tick) || input.tick < 0 || !input.agents || typeof input.agents !== 'object' || Array.isArray(input.agents)) {
    throw new BridgeError('invalid_observation', 'Expected a nonnegative tick and agent observations.', 400);
  }
  const ids = Object.keys(input.agents);
  if (!ids.length || ids.length > 3 || ids.some(id => !AGENTS.includes(id))) throw new BridgeError('invalid_observation', 'Agent ids must be agent1, agent2, or agent3.', 400);
  for (const id of ids) {
    const agent = input.agents[id];
    if (!agent || typeof agent !== 'object' || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
      throw new BridgeError('invalid_observation', 'Every agent needs finite x and y coordinates.', 400);
    }
  }
  return boundedData({ tick: input.tick, agents: input.agents, world: input.world || {} });
}

function validateAdvice(payload, observation) {
  if (!payload || payload.model !== TARGET_MODEL || payload.source !== 'model' || !payload.agents || typeof payload.agents !== 'object') {
    throw new BridgeError('identity_mismatch', 'Advice did not identify the verified v92 model.');
  }
  const expected = Object.keys(observation.agents).sort();
  const received = Object.keys(payload.agents).sort();
  if (JSON.stringify(expected) !== JSON.stringify(received)) throw new BridgeError('invalid_advice', 'Model advice must cover exactly the requested agents.');
  for (const id of expected) {
    const vector = payload.agents[id];
    if (!Array.isArray(vector) || vector.length !== 4 || vector.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1)) {
      throw new BridgeError('invalid_advice', 'Model advice requires four finite action values in [-1, 1].');
    }
  }
  return { tick: observation.tick, ttl: 30, influence: 0.2, agents: Object.fromEntries(expected.map(id => [id, [...payload.agents[id]]])) };
}

function createBridge(options = {}) {
  const env = options.env || process.env;
  const root = options.root ?? env.SUPERMIX_ROOT ?? (env.USERPROFILE ? path.join(env.USERPROFILE, 'Desktop', 'New folder (9)', 'Supermix') : null);
  const endpoint = localEndpoint(options.endpoint ?? env.SUPERMIX_ENDPOINT);
  const now = options.now || Date.now;
  const cacheMs = options.cacheMs ?? 10000;
  const minAdviceIntervalMs = options.minAdviceIntervalMs ?? 10000;
  const timeoutMs = options.timeoutMs ?? 3500;
  const healthTimeoutMs = options.healthTimeoutMs ?? 1500;
  let cache = null, cachedAt = -Infinity, pendingStatus = null, inferenceReady = false;
  let failures = 0, retryAt = 0, lastAdvice = -Infinity, advicePending = false;
  const safety = { readOnly: true, minAdviceIntervalMs, maxInfluence: 0.35, maxConcurrentRequests: 1, loadsCheckpoints: false };

  function failure() { inferenceReady = false; if (++failures >= 3) retryAt = now() + 60000; cache = null; }
  async function verifyService() {
    if (!endpoint) throw new BridgeError('inference_unconfigured', 'No already-serving v92 endpoint is configured; telemetry only.');
    if (now() < retryAt) throw new BridgeError('circuit_open', 'Inference requests are cooling down after repeated failures.');
    const health = await requestJSON(endpoint, '/health', 'GET', null, healthTimeoutMs);
    if (health.model !== TARGET_MODEL || health.loaded !== true || health.noLoad !== true || health.inferenceOnly !== true) {
      throw new BridgeError('identity_unverified', 'Endpoint must confirm model v92 is already resident, inference-only, and cannot load checkpoints.');
    }
    inferenceReady = true;
    return health;
  }

  async function status() {
    if (cache && now() - cachedAt < cacheMs) return cache;
    if (pendingStatus) return pendingStatus;
    pendingStatus = (async () => {
      const training = await readTelemetry(root, now());
      let reason = 'No already-serving v92 endpoint is configured; telemetry only.';
      if (endpoint) {
        try { await verifyService(); reason = 'Endpoint reports a resident v92 model with no-load inference.'; }
        catch (error) { reason = error.message; if (error.code !== 'circuit_open') failure(); }
      }
      const result = {
        schemaVersion: SCHEMA_VERSION, targetModel: TARGET_MODEL,
        mode: inferenceReady ? 'inference-ready' : training.state !== 'unavailable' ? 'telemetry-only' : 'unavailable',
        training, inference: { configured: Boolean(endpoint), ready: inferenceReady, verifiedModel: inferenceReady ? TARGET_MODEL : null, reason, retryAt: retryAt > now() ? new Date(retryAt).toISOString() : null }, safety,
      };
      cache = result; cachedAt = now(); return result;
    })();
    try { return await pendingStatus; } finally { pendingStatus = null; }
  }

  async function advice(input) {
    const observation = validateObservation(input);
    if (!endpoint) throw new BridgeError('inference_unconfigured', 'No already-serving v92 endpoint is configured; telemetry only.');
    if (advicePending || now() - lastAdvice < minAdviceIntervalMs) throw new BridgeError('rate_limited', 'Advice is limited to one request every 10 seconds.', 429);
    if (now() < retryAt) throw new BridgeError('circuit_open', 'Inference requests are cooling down after repeated failures.');
    advicePending = true; lastAdvice = now();
    try {
      // Recheck on every generation. A stale status poll cannot authorize inference.
      await verifyService();
      const payload = await requestJSON(endpoint, '/advice', 'POST', {
        schemaVersion: SCHEMA_VERSION, model: TARGET_MODEL, noLoad: true,
        actionOrder: ['up', 'down', 'left', 'right'], observation,
      }, timeoutMs);
      const result = { schemaVersion: SCHEMA_VERSION, source: 'model', model: TARGET_MODEL, advice: validateAdvice(payload, observation) };
      failures = 0; retryAt = 0; cache = null;
      return result;
    } catch (error) { failure(); throw error; }
    finally { advicePending = false; }
  }

  return { status, advice };
}

function jsonResponse(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

function trustedRequest(req) {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  const host = req.headers.host;
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  return true;
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new BridgeError('invalid_content_type', 'Use application/json.', 415);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 12288) throw new BridgeError('body_too_large', 'Observation exceeds 12 KiB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new BridgeError('invalid_json', 'Invalid JSON request.', 400); }
}

function createBridgeHandler(options) {
  const bridge = createBridge(options);
  return async (req, res) => {
    const route = new URL(req.url, 'http://127.0.0.1').pathname;
    if (!route.startsWith('/api/supermix/')) return false;
    if (!trustedRequest(req)) { jsonResponse(res, 403, { error: 'local_only', reason: 'This bridge requires a local same-origin request.' }); return true; }
    try {
      if (route === '/api/supermix/status' && req.method === 'GET') jsonResponse(res, 200, await bridge.status());
      else if (route === '/api/supermix/advice' && req.method === 'POST') jsonResponse(res, 200, await bridge.advice(await readBody(req)));
      else jsonResponse(res, 404, { error: 'not_found', reason: 'Unknown bridge route or method.' });
    } catch (error) {
      jsonResponse(res, error instanceof BridgeError ? error.status : 503, {
        error: error instanceof BridgeError ? error.code : 'bridge_unavailable',
        reason: error instanceof BridgeError ? error.message : 'The read-only bridge is temporarily unavailable.',
      });
    }
    return true;
  };
}

module.exports = { createBridge, createBridgeHandler, localEndpoint, readTelemetry, validateObservation, validateAdvice, extractMetrics };
