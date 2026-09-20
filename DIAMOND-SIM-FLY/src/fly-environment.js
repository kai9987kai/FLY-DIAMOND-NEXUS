(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlyEnvironment = api.FlyEnvironment;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const copy = value => JSON.parse(JSON.stringify(value));
  const DIRECTIONS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const PRESETS = {
    temperate: { temperature: 23, humidity: 0.58, windX: 0.25, windY: 0.08, precipitation: 0.08, resourceRegrowth: 0.45, threatActivity: 0.45 },
    rain: { temperature: 18, humidity: 0.92, windX: -0.35, windY: 0.3, precipitation: 0.9, resourceRegrowth: 0.85, threatActivity: 0.2 },
    drought: { temperature: 37, humidity: 0.18, windX: 0.5, windY: 0.15, precipitation: 0, resourceRegrowth: 0.08, threatActivity: 0.65 },
    storm: { temperature: 16, humidity: 0.88, windX: 1.1, windY: -0.85, precipitation: 0.95, resourceRegrowth: 0.65, threatActivity: 0.85 },
    calm: { temperature: 22, humidity: 0.65, windX: 0, windY: 0, precipitation: 0, resourceRegrowth: 0.5, threatActivity: 0.1 }
  };
  const LIMITS = { temperature: [0, 45], humidity: [0, 1], windX: [-1.5, 1.5], windY: [-1.5, 1.5], precipitation: [0, 1], resourceRegrowth: [0, 1], threatActivity: [0, 1] };

  /** Seeded toy ecology. All changes happen on logical ticks, never wall time. */
  class FlyEnvironment {
    constructor(seed = 2077, size = 20) {
      if (!Number.isInteger(size) || size < 4 || size > 100) throw new Error('Environment size must be 4..100');
      this.size = size;
      this.rngState = (Number(seed) ^ 0x9e3779b9) >>> 0;
      this.tick = 0;
      this.preset = 'temperate';
      this.dynamic = true;
      this.target = { ...PRESETS.temperate };
      this.weather = { ...this.target, visibility: 1 };
      this._visibility();
      this.walls = [];
      this.water = [];
      this.refuges = [];
      this.predators = [];
      this.resourcesGrown = 0;
      this.predatorHits = 0;
    }
    random() {
      this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
      let t = this.rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    setPreset(name) {
      if (!PRESETS[name]) throw new Error('Unknown weather preset');
      this.preset = name;
      this.target = { ...PRESETS[name] };
      this.weather = { ...this.target, visibility: 1 };
      this._visibility();
    }
    setVariable(name, value) {
      const limit = LIMITS[name];
      if (!limit || !Number.isFinite(value)) throw new Error('Invalid climate variable');
      this.target[name] = this.weather[name] = clamp(value, ...limit);
      this.preset = 'custom';
      this._visibility();
    }
    _visibility() { this.weather.visibility = clamp(1 - this.weather.precipitation * 0.42, 0.3, 1); }
    has(points, x, y) { return points.some(p => p.x === x && p.y === y); }
    isBlocked(x, y) { return x < 0 || y < 0 || x >= this.size || y >= this.size || this.has(this.walls, x, y); }
    attach(env) {
      env.walls = this.walls;
      env.water = this.water;
      env.refuges = this.refuges;
      env.predators = this.predators;
      env.environment = this.weather;
    }
    agents(env) {
      return ['agent1', 'agent2', 'agent3'].filter(id => Number.isFinite(env[id + 'X']) && Number.isFinite(env[id + 'Y']))
        .map(id => ({ id, x: env[id + 'X'], y: env[id + 'Y'] }));
    }
    seedTerrain(env) {
      const occupied = [...this.agents(env), ...env.diamonds, ...env.hazards];
      for (const [field, count] of [['water', 6], ['refuges', 4], ['predators', 2]]) {
        for (let attempt = 0; attempt < this.size * this.size && this[field].length < count; attempt++) {
          const x = Math.floor(this.random() * this.size), y = Math.floor(this.random() * this.size);
          if (occupied.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) < (field === 'predators' ? 3 : 1))) continue;
          const point = { x, y, strength: 1 };
          this[field].push(point); occupied.push(point);
        }
      }
      this.attach(env);
    }
    step(env) {
      this.tick++;
      if (this.dynamic && this.tick % 20 === 0) {
        for (const [key, magnitude] of [['temperature', 1.2], ['humidity', 0.04], ['windX', 0.18], ['windY', 0.18], ['precipitation', 0.07]]) {
          this.weather[key] = clamp(this.weather[key] * 0.8 + this.target[key] * 0.2 + (this.random() - 0.5) * magnitude, ...LIMITS[key]);
        }
        this._visibility();
      }
      const agents = this.agents(env);
      if (this.tick % 5 === 0) {
        for (const predator of this.predators) {
          if (this.random() > this.weather.threatActivity) continue;
          const prey = agents.filter(a => !this.has(this.refuges, a.x, a.y))
            .sort((a, b) => Math.hypot(a.x - predator.x, a.y - predator.y) - Math.hypot(b.x - predator.x, b.y - predator.y))[0];
          const choices = DIRECTIONS.map(([dx, dy]) => ({ x: predator.x + dx, y: predator.y + dy }))
            .filter(p => !this.isBlocked(p.x, p.y) && !this.has(this.refuges, p.x, p.y) && !this.predators.some(other => other !== predator && other.x === p.x && other.y === p.y));
          if (!choices.length) continue;
          const pursue = prey && Math.hypot(prey.x - predator.x, prey.y - predator.y) < 7;
          if (pursue) choices.sort((a, b) => Math.hypot(a.x - prey.x, a.y - prey.y) - Math.hypot(b.x - prey.x, b.y - prey.y));
          const next = choices[pursue ? 0 : Math.floor(this.random() * choices.length)];
          predator.x = next.x; predator.y = next.y;
        }
      }
      if (this.tick % 10 === 0 && env.diamonds.length < 24 && this.random() < this.weather.resourceRegrowth * (0.5 + this.weather.humidity * 0.5)) {
        // Bounded placement even when the arena has been filled with God Mode.
        const start = Math.floor(this.random() * this.size * this.size);
        for (let offset = 0; offset < this.size * this.size; offset++) {
          const index = (start + offset) % (this.size * this.size), x = index % this.size, y = Math.floor(index / this.size);
          if (this.isBlocked(x, y) || this.has(env.diamonds, x, y) || this.has(env.hazards, x, y) || this.has(agents, x, y)) continue;
          env.diamonds.push({ x, y }); this.resourcesGrown++; break;
        }
      }
      this.attach(env);
    }
    nearest(points, x, y) {
      let distance = Infinity, bearing = 0;
      for (const p of points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < distance) { distance = d; bearing = Math.atan2(p.y - y, p.x - x); }
      }
      return { proximity: Math.max(0, 1 - distance / 7), bearing };
    }
    sense(x, y, env) {
      const predator = this.nearest(this.predators, x, y), refuge = this.nearest(this.refuges, x, y), water = this.nearest(this.water, x, y);
      return { ...this.weather, resourcePressure: clamp(1 - (env?.diamonds.length || 0) / 24, 0, 1),
        predatorProximity: predator.proximity, predatorBearing: predator.bearing,
        refugeProximity: refuge.proximity, refugeBearing: refuge.bearing,
        waterProximity: water.proximity, waterBearing: water.bearing,
        inRefuge: this.has(this.refuges, x, y), inWater: this.has(this.water, x, y),
        legalActions: DIRECTIONS.map(([dx, dy]) => !this.isBlocked(x + dx, y + dy)) };
    }
    movementCost(x, y, dx, dy) {
      const heat = Math.max(0, this.weather.temperature - 27) * 0.055;
      const cold = Math.max(0, 12 - this.weather.temperature) * 0.025;
      const headwind = Math.max(0, -(dx * this.weather.windX + dy * this.weather.windY)) * 0.45;
      const dry = (1 - this.weather.humidity) * heat * 0.35;
      const shelter = this.has(this.refuges, x, y) ? 0.55 : 1;
      const cooling = this.has(this.water, x, y) ? 0.35 : 1;
      return (1 + heat * cooling + cold + dry + headwind + this.weather.precipitation * 0.12) * shelter;
    }
    predatorDamage(x, y) {
      if (this.has(this.refuges, x, y)) return 0;
      const p = this.predators.find(p => p.x === x && p.y === y);
      if (!p) return 0;
      this.predatorHits++;
      return 8 * (p.strength || 1) * (0.5 + this.weather.threatActivity);
    }
    brush(env, tool, x, y, radius = 0, strength = 1) {
      if (!['food', 'hazard', 'wall', 'erase', 'water', 'refuge', 'predator'].includes(tool)) throw new Error('Unknown terrain tool');
      if (![x, y, radius, strength].every(Number.isFinite)) throw new Error('Invalid brush coordinates');
      radius = clamp(Math.floor(radius), 0, 4); strength = clamp(strength, 0.25, 3);
      const agents = this.agents(env), affected = [];
      const field = { food: 'diamonds', hazard: 'hazards', wall: 'walls', water: 'water', refuge: 'refuges', predator: 'predators' }[tool];
      for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const px = Math.floor(x) + ox, py = Math.floor(y) + oy;
        if (px < 0 || py < 0 || px >= this.size || py >= this.size) continue;
        // Keep each occupied cell and its exits clear; painting can never engulf a fly.
        if (tool === 'wall' && agents.some(a => Math.abs(a.x - px) + Math.abs(a.y - py) <= 1)) continue;
        if (tool !== 'erase' && tool !== 'wall' && this.isBlocked(px, py)) continue;
        if (tool === 'predator' && (agents.some(a => a.x === px && a.y === py) || this.has(this.refuges, px, py))) continue;
        if (tool === 'erase' || tool === 'wall') {
          for (const name of ['diamonds', 'hazards']) env[name] = env[name].filter(p => p.x !== px || p.y !== py);
          for (const name of ['walls', 'water', 'refuges', 'predators']) this[name] = this[name].filter(p => p.x !== px || p.y !== py);
        }
        if (tool !== 'erase') {
          const points = field === 'diamonds' || field === 'hazards' ? env[field] : this[field];
          const existing = points.find(p => p.x === px && p.y === py);
          if (existing) existing.strength = strength;
          else if (field !== 'predators' || points.length < 20) points.push({ x: px, y: py, strength });
          if (tool === 'refuge') this.predators = this.predators.filter(p => p.x !== px || p.y !== py);
        }
        affected.push({ x: px, y: py });
      }
      this.attach(env);
      return affected;
    }
    snapshot() {
      return copy({ version: 1, size: this.size, rngState: this.rngState, tick: this.tick, preset: this.preset,
        dynamic: this.dynamic, target: this.target, weather: this.weather, walls: this.walls, water: this.water,
        refuges: this.refuges, predators: this.predators, resourcesGrown: this.resourcesGrown, predatorHits: this.predatorHits });
    }
    static restore(snapshot) {
      if (!snapshot || snapshot.version !== 1) throw new Error('Unsupported environment snapshot');
      const model = new FlyEnvironment(1, snapshot.size);
      if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0 || !Number.isInteger(snapshot.rngState) || snapshot.rngState < 0 || snapshot.rngState > 0xffffffff) throw new Error('Invalid environment clock or random state');
      for (const field of ['target', 'weather']) for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
        const value = snapshot[field]?.[key];
        if (!Number.isFinite(value) || value < lo || value > hi) throw new Error('Invalid saved climate');
      }
      for (const field of ['walls', 'water', 'refuges', 'predators']) {
        const points = snapshot[field];
        if (!Array.isArray(points) || points.length > model.size * model.size || points.some(p => !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= model.size || p.y >= model.size || !Number.isFinite(p.strength) || p.strength < 0.25 || p.strength > 3)) throw new Error('Invalid saved terrain');
        if (new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) throw new Error('Duplicate saved terrain');
      }
      if (typeof snapshot.dynamic !== 'boolean' || !['temperate', 'rain', 'drought', 'storm', 'calm', 'custom'].includes(snapshot.preset)) throw new Error('Invalid environment settings');
      for (const field of ['resourcesGrown', 'predatorHits']) if (!Number.isInteger(snapshot[field]) || snapshot[field] < 0) throw new Error('Invalid environment counters');
      const allowed = ['version', 'size', 'rngState', 'tick', 'preset', 'dynamic', 'target', 'weather', 'walls', 'water', 'refuges', 'predators', 'resourcesGrown', 'predatorHits'];
      if (Object.keys(snapshot).some(key => !allowed.includes(key))) throw new Error('Unknown environment snapshot field');
      for (const key of allowed) if (key !== 'version') model[key] = copy(snapshot[key]);
      model._visibility();
      if (['water', 'refuges', 'predators'].some(field => model[field].some(p => model.isBlocked(p.x, p.y)))) throw new Error('Terrain overlaps a wall');
      return model;
    }
  }
  FlyEnvironment.PRESETS = Object.freeze(PRESETS);
  return { FlyEnvironment };
});
