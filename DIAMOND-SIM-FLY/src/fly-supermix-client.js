/* Read-only local Supermix telemetry and bounded asynchronous graft advice. */
(function (root) {
  'use strict';
  if (!root.document || !root.flyLab) return;
  const host = document.getElementById('supermixPanel');
  if (!host) return;
  host.innerHTML = '<div class="panel-title">Supermix · external graft</div>' +
    '<p id="supermixMode" role="status">Checking local bridge…</p>' +
    '<p id="supermixTraining" style="font-size:12px;line-height:1.6;color:#9bb0cb"></p>' +
    '<label style="font-size:12px;display:flex;gap:8px;align-items:center"><input id="supermixEnabled" type="checkbox" checked>Use verified model advice</label>' +
    '<p id="supermixAdvice" style="font-size:12px;line-height:1.6;color:#9bb0cb">Advice is limited to 35% of the graft vote and expires after 30 ticks.</p>' +
    '<button class="btn btn-neutral" id="supermixRefresh" type="button">Refresh connection</button>';
  const mode = document.getElementById('supermixMode');
  const training = document.getElementById('supermixTraining');
  const adviceText = document.getElementById('supermixAdvice');
  const enabled = document.getElementById('supermixEnabled');
  const refresh = document.getElementById('supermixRefresh');
  let status = null, busy = false, lastAdvice = -Infinity, lastReceipt = null;
  let applied = 0, stale = 0;

  async function request(route, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), body ? 15000 : 4500);
    try {
      const response = await fetch(route, {
        method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
        headers: body ? {'Content-Type': 'application/json'} : {},
        ...(body ? {body: JSON.stringify(body)} : {})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reason || data.error || 'Bridge unavailable');
      return data;
    } finally { clearTimeout(timer); }
  }

  function observation() {
    if (typeof root.flyLab.observation === 'function') return root.flyLab.observation();
    const lab = root.flyLab, env = lab.env, agents = {};
    for (let i = 1; i <= 3; i++) {
      const key = 'agent' + i;
      agents[key] = {x: env[key + 'X'], y: env[key + 'Y'], energy: env[key + 'Energy']};
    }
    return {tick: lab.telemetry().tick, agents, world: {seed: env.seed, gridSize: env.gridSize}};
  }

  async function poll() {
    if (busy || document.hidden) return;
    if (!/^https?:$/.test(location.protocol)) {
      mode.textContent = 'Bridge requires the local server';
      training.textContent = 'Run npm run serve to read Supermix telemetry. The simulation works offline.';
      return;
    }
    busy = true; refresh.disabled = true;
    try {
      status = await request('/api/supermix/status');
      const ready = status.mode === 'inference-ready' && status.inference?.ready === true;
      mode.textContent = ready ? 'Connected · verified ' + status.inference.verifiedModel :
        status.mode === 'telemetry-only' ? 'Connected · telemetry only' : 'Model unavailable';
      const t = status.training || {}, metrics = t.metrics || {};
      training.textContent = [(status.targetModel || 'Supermix') + ': ' + (t.state || 'unverified'), t.message,
        Number.isFinite(metrics.step) ? 'Step ' + metrics.step + (Number.isFinite(metrics.totalSteps) ? '/' + metrics.totalSteps : '') : '',
        Number.isFinite(metrics.loss) ? 'Loss ' + metrics.loss.toFixed(4) : '',
        !ready ? status.inference?.reason : ''].filter(Boolean).join(' · ');
      if (!ready) adviceText.textContent = 'No model advice applied. Training files and running jobs remain untouched.';
      const now = performance.now();
      if (ready && enabled.checked && root.flyLab.running && now - lastAdvice >= Math.max(10000, status.safety?.minAdviceIntervalMs || 10000)) {
        lastAdvice = now;
        const graft = root.flyLab.graft, seed = root.flyLab.env.seed;
        const input = observation();
        const response = await request('/api/supermix/advice', input);
        const tick = root.flyLab.telemetry().tick;
        if (root.flyLab.graft !== graft || root.flyLab.env.seed !== seed || tick < input.tick ||
            tick >= input.tick + 30 || !enabled.checked || !root.flyLab.running ||
            response.source !== 'model' || response.model !== status.inference.verifiedModel) {
          stale++; adviceText.textContent = 'Delayed advice discarded; local agents remain in control.';
          return;
        }
        // Keep the request tick: network delay must never refresh old advice.
        const proposal = {...response.advice, tick: input.tick, source: response.source, model: response.model};
        if (graft.setExternalAdvice(proposal)) {
          applied++; lastReceipt = {model: response.model, tick: input.tick, expires: input.tick + proposal.ttl};
          adviceText.textContent = 'Received ' + response.model + ' advice at tick ' + input.tick + '; expires at ' + lastReceipt.expires + '.';
        } else adviceText.textContent = 'Advice rejected by the graft; local policy continues.';
      }
    } catch (error) {
      mode.textContent = 'Bridge unavailable · local agents continue';
      training.textContent = error.name === 'AbortError' ? 'Connection timed out.' : error.message;
    } finally { busy = false; refresh.disabled = false; }
  }
  enabled.addEventListener('change', () => {
    if (!enabled.checked) {
      if (typeof root.flyLab.graft.clearExternalAdvice === 'function') root.flyLab.graft.clearExternalAdvice();
      else root.flyLab.graft.setExternalAdvice(null);
      adviceText.textContent = 'Model advice disabled.';
    }
  });
  refresh.addEventListener('click', poll);
  root.flySupermix = {poll, observation, get status() {return status;}, get receipt() {return lastReceipt;},
    get counters() {return {applied, stale};}};
  poll();
  const timer = setInterval(poll, 10000);
  root.addEventListener('pagehide', () => clearInterval(timer), {once: true});
})(typeof globalThis !== 'undefined' ? globalThis : this);
