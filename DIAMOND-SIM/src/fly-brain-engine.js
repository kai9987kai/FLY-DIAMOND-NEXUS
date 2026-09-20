/**
 * @file fly-brain-engine.js
 * Biologically-inspired computational simulation of 11 interconnected Drosophila
 * (fruit fly) brain connectomes with offline Pre-Training, dynamic neurogenesis,
 * 3-factor LTM plasticity, tri-neuromodulation (Dopamine, Octopamine, Serotonin),
 * Central Complex vector navigation, Optic Lobe motion flow, Subesophageal Zone (SEZ)
 * metabolic homeostasis, Lateral Accessory Lobe (LAL) flip-flop casting, VNC CPG gait
 * rhythm, Johnston's Organ AMMC mechanosensory signals, and Dual-Agent Graph Grafting
 * with Stagnation Inactivity Hazards.
 *
 * Grounded in connectomic architectures catalogued in Drosophila male CNS
 * research (e.g. malecns / Janelia FlyEM):
 *  - Antennal Lobe (AL): Glomerular sensory projection neurons & local interneurons
 *  - Mushroom Body (MB): Sparse Kenyon Cells (KCs), APL inhibition, MBON readout
 *  - Central Complex (CX): Ring attractor compass (E-PG, P-EN) and Fan-Shaped Body (FB) vector steering
 *  - Optic Lobe (OL): Medulla and Lobula motion flow & visual gradient processing
 *  - Executive Fan-Shaped Body (FB): Working memory goal vector pursuit & trajectory planning
 *  - Subesophageal Zone (SEZ / GNG): Taste & metabolic homeostasis, satiety, and feeding arousal
 *  - Lateral Accessory Lobe (LAL): Premotor flip-flop zigzagging cast-and-surge maneuvers
 *  - Ventral Nerve Cord CPG (VNC): Thoracic central pattern generator gait velocity & motor torque
 *  - Johnston's Organ AMMC: Antennal mechanosensory, acoustic chirp & vibration peer communication
 *  - Inter-Brain Commissures: 11x11x4 cross-brain synthetic synaptic projections
 *  - Dual Grafted Multi-Agent Graph: Coordinated Harvester & Sentinel-Pioneer agents
 *  - Stagnation / Stasis Inactivity Hazard: Dwell-time penalty forcing kinetic exploration
 *  - Resumable State: Complete JSON serialization/deserialization with localStorage and file export
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FlyBrainEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  function softmax(arr, temperature = 1.0) {
    const max = Math.max(...arr);
    const exp = arr.map(v => Math.exp(clamp((v - max) / temperature, -20, 20)));
    const sum = exp.reduce((a, b) => a + b, 0) || 1e-6;
    return exp.map(v => v / sum);
  }

  /** Shortest signed angular difference, in (-pi, pi]. */
  function angleDelta(a, b) {
    let d = (a - b) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  }

  function wrapAngle(a) {
    const t = a % (2 * Math.PI);
    return t < 0 ? t + 2 * Math.PI : t;
  }

  /**
   * Mechanism selection. Each option names a circuit model; the "legacy" values
   * reproduce the behaviour of earlier versions so that an upgrade can be
   * measured against it rather than merely asserted.
   *
   * compass:     "attractor" - recurrent E-PG/P-EN ring attractor in the CX,
   *                            heading persists in population activity and is
   *                            integrated from angular velocity.
   *              "kinematic" - legacy: heading is a scalar the caller sets and
   *                            the ring is only drawn from it.
   * mbInhibition:"apl"       - APL pools Kenyon-cell output and feeds back
   *                            divisive plus subtractive inhibition, so
   *                            sparseness emerges from gain control.
   *              "topk"      - legacy: hard top-15% selection by sorting.
   * plasticity:  "dan-ltd"   - dopamine-gated depression of coincidently active
   *                            KC->MBON synapses, with slow recovery.
   *              "hebbian"   - legacy: symmetric potentiation and depression on
   *                            a net modulation term.
   */
  const DEFAULT_CONFIG = Object.freeze({
    compass: "attractor",
    mbInhibition: "apl",
    plasticity: "dan-ltd",
    // The APL loop has no set point: sparseness is whatever this gain and the
    // current input produce. kcTargetSparsity records the design target the
    // gains were calibrated against (Kenyon-cell responses are reported in the
    // few-percent to ~20% range) and is not enforced.
    kcTargetSparsity: 0.1,
    aplFeedbackGain: 3.4,
    aplDivisiveGain: 2.6,
    aplSubtractiveGain: 0.55,
    ringExcitation: 1.6,
    ringInhibition: 0.55,
    ringSigma: 0.62,
    ringRate: 0.9,
    // Calibrated so decoded heading tracks integrated angular velocity with
    // gain 0.99-1.01 over +/-0.4 rad per tick; relaxation at ringRate would
    // otherwise leave the bump lagging by that factor.
    ringShiftGain: 1.1,
    ltdRate: 0.055,
    ltdRecovery: 0.004,
    kcMbonBaseline: 0.25
  });

  const LEGACY_CONFIG = Object.freeze(Object.assign({}, DEFAULT_CONFIG, {
    compass: "kinematic",
    mbInhibition: "topk",
    plasticity: "hebbian"
  }));

  function resolveConfig(overrides) {
    if (overrides === "legacy") return Object.assign({}, LEGACY_CONFIG);
    if (overrides === "default" || !overrides) return Object.assign({}, DEFAULT_CONFIG);
    const base = overrides.preset === "legacy" ? LEGACY_CONFIG : DEFAULT_CONFIG;
    const merged = Object.assign({}, base, overrides);
    delete merged.preset;
    return merged;
  }

  // -------------------------------------------------------------
  // Deterministic PRNG: Mulberry32
  // -------------------------------------------------------------
  class MulberryPRNG {
    constructor(seed = 42) {
      this.initialSeed = typeof seed === "string" ? this._hashString(seed) : (seed >>> 0);
      this.state = this.initialSeed;
      this.drawCount = 0;
    }

    _hashString(str) {
      let hash = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
        hash = (hash << 13) | (hash >>> 19);
      }
      return hash >>> 0;
    }

    next() {
      this.drawCount++;
      let t = (this.state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    int(max) {
      return Math.floor(this.next() * max);
    }

    /**
     * Capture the full generator state. `state` is the only value that
     * determines future draws; `drawCount` is bookkeeping. Restoring
     * `drawCount` alone leaves the stream where it started, so both are
     * required for an exact resume.
     */
    getState() {
      return { initialSeed: this.initialSeed, state: this.state, drawCount: this.drawCount };
    }

    setState(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return this;
      if (Number.isFinite(snapshot.initialSeed)) this.initialSeed = snapshot.initialSeed >>> 0;
      if (Number.isFinite(snapshot.state)) this.state = snapshot.state >>> 0;
      if (Number.isFinite(snapshot.drawCount)) this.drawCount = snapshot.drawCount;
      return this;
    }

    /** Fork an independent stream so a subsystem cannot perturb the caller's draws. */
    fork(salt = 0) {
      const child = new MulberryPRNG(0);
      child.initialSeed = (this.initialSeed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
      child.state = child.initialSeed;
      return child;
    }
  }

  // -------------------------------------------------------------
  // Dynamic 2D Chemical & Pheromone Layer (Odor Plumes & Scent Trails)
  // -------------------------------------------------------------
  class ChemicalFieldGrid {
    /**
     * @param {number} width
     * @param {number} height
     */
    constructor(width = 20, height = 20) {
      this.width = width;
      this.height = height;
      const size = width * height;
      this.foodOdor = new Float32Array(size);
      this.threatOdor = new Float32Array(size);
      this.foragerTrail = new Float32Array(size);
      this.sentinelTrail = new Float32Array(size);
      this.customPheromone = new Float32Array(size);
    }

    _idx(x, y) {
      const cx = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
      const cy = Math.max(0, Math.min(this.height - 1, Math.floor(y)));
      return cy * this.width + cx;
    }

    emit(channel, x, y, amount) {
      if (!this[channel]) return;
      const idx = this._idx(x, y);
      this[channel][idx] = Math.min(3.0, this[channel][idx] + amount);
    }

    sample(channel, x, y) {
      if (!this[channel]) return 0;
      const x0 = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
      const y0 = Math.max(0, Math.min(this.height - 1, Math.floor(y)));
      const x1 = Math.min(this.width - 1, x0 + 1);
      const y1 = Math.min(this.height - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;

      const arr = this[channel];
      const top = arr[y0 * this.width + x0] * (1 - fx) + arr[y0 * this.width + x1] * fx;
      const bottom = arr[y1 * this.width + x0] * (1 - fx) + arr[y1 * this.width + x1] * fx;
      return top * (1 - fy) + bottom * fy;
    }

    /**
     * Bilateral antennal sampling: evaluates odor concentration at left and right antenna
     * @param {string} channel
     * @param {number} x
     * @param {number} y
     * @param {number} heading
     * @param {number} antennaDist
     */
    sampleBilateral(channel, x, y, heading = 0, antennaDist = 0.8) {
      const leftAngle = heading - Math.PI / 2;
      const rightAngle = heading + Math.PI / 2;
      const lx = x + Math.cos(leftAngle) * antennaDist;
      const ly = y + Math.sin(leftAngle) * antennaDist;
      const rx = x + Math.cos(rightAngle) * antennaDist;
      const ry = y + Math.sin(rightAngle) * antennaDist;

      const left = this.sample(channel, lx, ly);
      const right = this.sample(channel, rx, ry);
      return { left, right, diff: left - right };
    }

    step(diffusionRate = 0.15, decayRate = 0.95) {
      this._diffuseChannel(this.foodOdor, diffusionRate, decayRate);
      this._diffuseChannel(this.threatOdor, diffusionRate, decayRate);
      this._diffuseChannel(this.foragerTrail, diffusionRate, 0.93);
      this._diffuseChannel(this.sentinelTrail, diffusionRate, 0.93);
      this._diffuseChannel(this.customPheromone, diffusionRate, 0.96);
    }

    _diffuseChannel(grid, diffRate, decay) {
      const w = this.width;
      const h = this.height;
      const next = new Float32Array(grid.length);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          let sumNeighbors = 0;
          let numNeighbors = 0;

          if (x > 0) { sumNeighbors += grid[i - 1]; numNeighbors++; }
          if (x < w - 1) { sumNeighbors += grid[i + 1]; numNeighbors++; }
          if (y > 0) { sumNeighbors += grid[i - w]; numNeighbors++; }
          if (y < h - 1) { sumNeighbors += grid[i + w]; numNeighbors++; }

          const laplacian = (sumNeighbors / numNeighbors) - grid[i];
          const val = (grid[i] + diffRate * laplacian) * decay;
          next[i] = val > 0.001 ? val : 0;
        }
      }
      grid.set(next);
    }

    clear() {
      this.foodOdor.fill(0);
      this.threatOdor.fill(0);
      this.foragerTrail.fill(0);
      this.sentinelTrail.fill(0);
      this.customPheromone.fill(0);
    }
  }

  // -------------------------------------------------------------
  // Simulated Drosophila Single Brain Subsystem (11 Specialized Roles)
  // -------------------------------------------------------------
  class DrosophilaBrain {
    /**
     * @param {number} id - Brain ID (0 to 10)
     * @param {string} role - Specialized computational role
     */
    constructor(id, role = "general", config = null) {
      this.id = id;
      this.role = role;
      this.config = resolveConfig(config);

      // Neuropil dimensions
      this.GLOMERULI_COUNT = 14;
      this.KC_BASE_COUNT = 32;
      this.MBON_COUNT = 4;
      this.COMPASS_COUNT = 8;

      // Activations
      this.alProjection = new Float32Array(this.GLOMERULI_COUNT);
      this.kcActivations = new Float32Array(this.KC_BASE_COUNT);
      this.mbonActivations = new Float32Array(this.MBON_COUNT);
      this.compassRing = new Float32Array(this.COMPASS_COUNT);
      this.compassHeading = 0;

      // E-PG ring attractor state (Central Complex compass). Unlike compassRing,
      // which is only a readout, this is the recurrent activity that carries
      // heading between ticks.
      this.epgRing = new Float32Array(this.COMPASS_COUNT);
      this.epgRing[0] = 1.0;
      this.ringAmplitude = 1.0;
      this.ringCertainty = 1.0;

      // Mushroom-body gain control readouts
      this.aplActivity = 0;
      this.kcSparsity = 0;
      this.lastActionIndex = -1;

      // Brain 5: Optic Lobe motion flow
      this.opticMotionFlow = new Float32Array(4);
      this.lastVisualSensors = [0, 0, 0, 0];

      // Brain 6: Executive FB target vector
      this.targetVector = { x: 0, y: 0, distance: 0, heading: 0, active: false };

      // Brain 7: SEZ Metabolic registers
      this.metabolicSatiety = 1.0;
      this.sugarDrive = 0.5;
      this.bitterAversion = 0.0;
      this.neuropeptideNPF = 0.0;
      this.neuropeptideSIFamide = 0.0;

      // Brain 8: Lateral Accessory Lobe (LAL) Flip-Flop state
      this.lalFlipFlop = 0; // -1 (left cast), 1 (right cast)
      this.lalTimer = 0;

      // Brain 9: Ventral Nerve Cord (VNC) CPG Gait Phase
      this.vncGaitPhase = 0;
      this.vncTorque = 1.0;

      // Brain 10: Johnston's Organ AMMC Mechanosensory & Peer Acoustic Signals
      this.ammcVibration = 0.0;
      this.ammcPeerAcoustic = [0, 0]; // dx, dy to peer agent

      // Brain 11: Protocerebral Bridge (PB) Bilateral Phase Shift Steering
      this.pbPhaseShift = 0.0;

      // Brain 12: Ellipsoid Body (EB) Toroid Landmark Ring
      this.ebRingAttractor = new Float32Array(8);
      this.ebStabilization = 0.0;

      // Brain 13: Noduli (NO) Odometry & Path Integration
      this.noOdometryDistance = 0.0;
      this.noHomeVector = [0, 0];
      this.homeHeading = 0.0;

      // Brain 14: Anterior Optic Tubercle (AOTU) Celestial Sun Compass
      this.aotuSunHeading = 0.0;
      this.aotuEVectorAlignment = 0.0;

      // Brain 15: Superior Medial Protocerebrum (SMP) Action Commitment Latch
      this.smpLatchedAction = -1;
      this.smpLatchTimer = 0;

      // Tri-Neuromodulatory signaling:
      this.dopaminePAM = 0.0;
      this.dopaminePPL1 = 0.0;
      this.octopamineOA = 0.2;
      this.serotonin5HT = 0.5;
      this.pdfArousal = 1.0; // Circadian Pigment-Dispersing Factor motor vigor scaling

      // Giant Fiber (GF) Looming-Stimulus Escape System
      this.giantFiberTriggered = false;
      this.lastHazardSense = 0.0;
      this.loomingVelocity = 0.0;

      // Drosophila Neuropeptides: NPF (Hunger Risk-Seeking) & SIFamide (Satiety Social/Calm)
      this.neuropeptideNPF = 0.0;
      this.neuropeptideSIFamide = 0.0;

      // Dynamic Neurogenesis Pool (born Kenyon Cells)
      this.bornNeurons = [];

      // Synaptic weight matrices:
      this.alToKcWeights = this._initSparseAlKcWeights(this.KC_BASE_COUNT);
      this.kcToMbonWeights = this._initKcMbonWeights(this.KC_BASE_COUNT);
      this.eligibilityTraces = new Float32Array(this.KC_BASE_COUNT * this.MBON_COUNT);
      this.descendingOutputs = new Float32Array(4);
    }

    /**
     * Registers that belong to one individual fly rather than to the shared
     * connectome: heading, gait phase, metabolic titres, latches, activations.
     * Learned synaptic weights are deliberately absent -- those are shared.
     */
    static EGO_SCALARS = [
      "compassHeading", "lalFlipFlop", "lalTimer", "vncGaitPhase", "vncTorque",
      "ammcVibration", "pbPhaseShift", "ebStabilization",
      "noOdometryDistance", "homeHeading", "aotuSunHeading", "aotuEVectorAlignment",
      "smpLatchedAction", "smpLatchTimer",
      "metabolicSatiety", "sugarDrive", "bitterAversion",
      "neuropeptideNPF", "neuropeptideSIFamide",
      "dopaminePAM", "dopaminePPL1", "octopamineOA", "serotonin5HT", "pdfArousal",
      "lastHazardSense", "loomingVelocity", "giantFiberTriggered",
      "ringAmplitude", "ringCertainty", "aplActivity", "kcSparsity", "lastActionIndex"
    ];

    static EGO_ARRAYS = [
      "alProjection", "kcActivations", "mbonActivations", "compassRing",
      "opticMotionFlow", "ebRingAttractor", "descendingOutputs", "epgRing"
    ];

    /** Copy this brain's per-individual registers into a reusable container. */
    captureEgo(into = null) {
      const ego = into || { scalars: Object.create(null), arrays: Object.create(null), born: null };
      for (const key of DrosophilaBrain.EGO_SCALARS) ego.scalars[key] = this[key];
      for (const key of DrosophilaBrain.EGO_ARRAYS) {
        const src = this[key];
        if (!src) continue;
        let dst = ego.arrays[key];
        if (!dst || dst.length !== src.length) dst = ego.arrays[key] = new Float32Array(src.length);
        dst.set(src);
      }
      ego.arrays.lastVisualSensors = Float32Array.from(this.lastVisualSensors);
      ego.arrays.ammcPeerAcoustic = Float32Array.from(this.ammcPeerAcoustic);
      ego.arrays.noHomeVector = Float32Array.from(this.noHomeVector);
      const born = ego.born && ego.born.length === this.bornNeurons.length
        ? ego.born
        : new Float32Array(this.bornNeurons.length);
      for (let i = 0; i < this.bornNeurons.length; i++) born[i] = this.bornNeurons[i].activation;
      ego.born = born;
      return ego;
    }

    /** Load per-individual registers previously captured by captureEgo. */
    restoreEgo(ego) {
      if (!ego) return;
      for (const key of DrosophilaBrain.EGO_SCALARS) {
        if (ego.scalars[key] !== undefined) this[key] = ego.scalars[key];
      }
      for (const key of DrosophilaBrain.EGO_ARRAYS) {
        const src = ego.arrays[key];
        if (src && this[key] && this[key].length === src.length) this[key].set(src);
      }
      if (ego.arrays.lastVisualSensors) this.lastVisualSensors = Array.from(ego.arrays.lastVisualSensors);
      if (ego.arrays.ammcPeerAcoustic) this.ammcPeerAcoustic = Array.from(ego.arrays.ammcPeerAcoustic);
      if (ego.arrays.noHomeVector) this.noHomeVector = Array.from(ego.arrays.noHomeVector);
      if (ego.born) {
        const n = Math.min(ego.born.length, this.bornNeurons.length);
        for (let i = 0; i < n; i++) this.bornNeurons[i].activation = ego.born[i];
      }
    }

    /**
     * One update of the E-PG ring attractor.
     *
     * Local recurrent excitation sustains a single activity bump; pooled
     * inhibition keeps exactly one bump alive; and an angular-velocity input
     * shifts it, which is the P-EN contribution. Heading is then read out as
     * the population vector average, so it is held by the network rather than
     * supplied by the caller.
     *
     * @param {number} angularVelocity - radians per tick
     * @param {number} [anchorHeading] - external reference (landmark or sun)
     * @param {number} [anchorGain] - how strongly the anchor pins the bump
     */
    updateRingAttractor(angularVelocity = 0, anchorHeading = null, anchorGain = 0) {
      const n = this.COMPASS_COUNT;
      const cfg = this.config;
      const ring = this.epgRing;

      let pooled = 0;
      for (let i = 0; i < n; i++) pooled += ring[i];
      const inhibition = (cfg.ringInhibition * pooled) / n;

      // P-EN shift, as a rotation of the recurrent kernel rather than a
      // finite-difference nudge. E-PG cells excite P-EN cells that project back
      // one wedge over, in the direction the fly is turning, so the bump moves
      // by the angular velocity itself: the integrator has unit gain by
      // construction instead of needing a tuned coefficient.
      const shift = cfg.ringShiftGain * angularVelocity;
      const sigma = cfg.ringSigma;
      const twoSigmaSq = 2 * sigma * sigma;

      const next = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const prefAngle = (i / n) * 2 * Math.PI;
        let acc = 0;
        let kernelSum = 0;
        for (let j = 0; j < n; j++) {
          const srcAngle = (j / n) * 2 * Math.PI;
          const d = angleDelta(prefAngle - shift, srcAngle);
          const k = Math.exp(-(d * d) / twoSigmaSq);
          acc += k * ring[j];
          kernelSum += k;
        }
        // Normalising by the kernel mass keeps the recurrent term on the same
        // scale as the activity it drives, so the wedge lattice cannot pin the
        // bump and the integrator keeps unit gain.
        const recurrent = kernelSum > 0 ? acc / kernelSum : 0;

        let drive = cfg.ringExcitation * recurrent - inhibition;

        if (anchorHeading !== null && anchorGain > 0) {
          const d = angleDelta(prefAngle, anchorHeading);
          drive += anchorGain * Math.exp(-(d * d) / twoSigmaSq);
        }

        // Activity relaxes toward the network drive at ringRate; this is the
        // membrane time constant of the standard continuous-attractor model.
        next[i] = Math.max(0, ring[i] + cfg.ringRate * (drive - ring[i]));
      }

      let total = 0;
      for (let i = 0; i < n; i++) total += next[i];
      if (total < 1e-6) {
        // The bump died; re-seed it at the last decoded heading rather than
        // silently reporting an all-zero compass.
        const seed = Math.round((this.compassHeading / (2 * Math.PI)) * n) % n;
        next[(seed + n) % n] = 1.0;
        total = 1.0;
      }
      // Normalising keeps total activity bounded without capping any wedge.
      for (let i = 0; i < n; i++) ring[i] = next[i] / total;

      let sx = 0;
      let sy = 0;
      for (let i = 0; i < n; i++) {
        const prefAngle = (i / n) * 2 * Math.PI;
        sx += ring[i] * Math.cos(prefAngle);
        sy += ring[i] * Math.sin(prefAngle);
      }
      this.ringAmplitude = Math.hypot(sx, sy);
      // Population vector length: 1 for a single sharp wedge, 0 for a flat ring.
      this.ringCertainty = clamp(this.ringAmplitude, 0, 1);
      this.compassHeading = wrapAngle(Math.atan2(sy, sx));
      return this.compassHeading;
    }

    /**
     * APL feedback inhibition over the Kenyon-cell population.
     *
     * The APL neuron pools Kenyon-cell output and inhibits the whole
     * population, both divisively and subtractively. Sparseness therefore
     * emerges from the strength of the input instead of being pinned to a fixed
     * fraction, and a few fixed-point iterations settle the loop in O(cells).
     *
     * @param {Array<{isBorn:boolean,idx:number,val:number}>} pool
     * @returns {number} the settled APL activity
     */
    _settleApl(pool) {
      const cfg = this.config;
      const n = pool.length || 1;
      const relax = 0.6;
      let apl = 0;
      // Damped iteration. Solving the loop undamped overshoots and then
      // collapses to zero inhibition on alternating passes, which is how a
      // feedback circuit with too much loop gain misbehaves in simulation as
      // well as in a cell.
      for (let iteration = 0; iteration < 8; iteration++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const v = pool[i].val / (1 + cfg.aplDivisiveGain * apl) - cfg.aplSubtractiveGain * apl;
          if (v > 0) sum += v;
        }
        const target = cfg.aplFeedbackGain * (sum / n);
        apl += relax * (target - apl);
        if (apl < 0) apl = 0;
      }
      return apl;
    }

    _initSparseAlKcWeights(kcCount) {
      const weights = new Float32Array(this.GLOMERULI_COUNT * kcCount);
      for (let k = 0; k < kcCount; k++) {
        const numInputs = 3 + (k % 2);
        for (let i = 0; i < numInputs; i++) {
          const g = (k * 3 + i * 5 + this.id) % this.GLOMERULI_COUNT;
          weights[k * this.GLOMERULI_COUNT + g] = 0.4 + 0.2 * ((k + i) % 3);
        }
      }
      return weights;
    }

    _initKcMbonWeights(kcCount) {
      const w = new Float32Array(kcCount * this.MBON_COUNT);
      for (let i = 0; i < w.length; i++) {
        w[i] = 0.25;
      }
      return w;
    }

    forward(sensoryInput, headingDelta = 0, executiveContext = null, peerContext = null) {
      // 1. Antennal Lobe (AL) Divisive Normalization
      let meanSensory = 0;
      for (let i = 0; i < this.GLOMERULI_COUNT; i++) {
        const val = sensoryInput[i] || 0;
        this.alProjection[i] = Math.max(0, val);
        meanSensory += this.alProjection[i];
      }
      meanSensory /= this.GLOMERULI_COUNT;

      for (let i = 0; i < this.GLOMERULI_COUNT; i++) {
        this.alProjection[i] = this.alProjection[i] / (0.2 + meanSensory);
      }

      // Brain 5: Optic Lobe Motion Flow
      if (this.role === "optic") {
        const visualSensors = sensoryInput.slice(6, 10);
        for (let v = 0; v < 4; v++) {
          const delta = visualSensors[v] - this.lastVisualSensors[v];
          this.opticMotionFlow[v] = 0.6 * this.opticMotionFlow[v] + 0.4 * delta;
          this.lastVisualSensors[v] = visualSensors[v];
        }
      }

      // Brain 6: Executive Fan-Shaped Body Vector Navigation
      if (this.role === "executive" && executiveContext) {
        this.targetVector = executiveContext;
      }

      // Brain 7: SEZ Metabolic Satiety, Taste & Neuropeptides
      if (this.role === "metabolic") {
        const energyNorm = sensoryInput[4] || 0.5;
        this.metabolicSatiety = energyNorm;
        this.sugarDrive = clamp(1.2 - energyNorm, 0.2, 1.8);
        this.bitterAversion = clamp((sensoryInput[3] || 0) * 2.0, 0, 2.0);
        this.octopamineOA = clamp(0.2 + (1.0 - energyNorm) * 0.8, 0.2, 1.0);
        this.serotonin5HT = clamp(energyNorm * 0.9, 0.1, 1.0);

        // Drosophila Neuropeptides: NPF (Hunger Risk-Taking) & SIFamide (Satiety Social/Calm)
        this.neuropeptideNPF = clamp((0.55 - energyNorm) * 2.2, 0, 1.0);
        this.neuropeptideSIFamide = clamp((energyNorm - 0.5) * 2.0, 0, 1.0);
      }

      // Brain 8: Lateral Accessory Lobe (LAL) Bistable Flip-Flop
      if (this.role === "lal") {
        this.lalTimer++;
        if (this.lalTimer > 3) {
          this.lalTimer = 0;
          this.lalFlipFlop = this.lalFlipFlop <= 0 ? 1 : -1;
        }
      }

      // Brain 9: Ventral Nerve Cord (VNC) CPG Gait Stride
      if (this.role === "vnc_cpg") {
        this.vncGaitPhase = (this.vncGaitPhase + 0.25) % (Math.PI * 2);
        this.vncTorque = 0.85 + 0.3 * Math.sin(this.vncGaitPhase);
      }

      // Brain 10: Johnston's Organ AMMC (Peer Acoustic & Tactile Signals)
      if (this.role === "ammc" && peerContext) {
        this.ammcPeerAcoustic = [peerContext.dx, peerContext.dy];
        this.ammcVibration = clamp(1.0 / (peerContext.dist + 0.1), 0, 2.0);
      }

      // Brain 11: Protocerebral Bridge (PB) Bilateral Phase Shift Steering
      if (this.role === "pb") {
        this.pbPhaseShift = Math.sin(this.compassHeading * 2);
      }

      // Brain 12: Ellipsoid Body (EB) Landmark Stabilization
      if (this.role === "eb") {
        for (let r = 0; r < 8; r++) {
          this.ebRingAttractor[r] = Math.cos(this.compassHeading - (r * Math.PI / 4));
        }
        this.ebStabilization = (this.ebRingAttractor[0] + this.ebRingAttractor[2]) * 0.5;
      }

      // Brain 13: Noduli (NO) Odometry & Path Integration
      if (this.role === "no" && peerContext) {
        const sDx = peerContext.stepDx || 0;
        const sDy = peerContext.stepDy || 0;
        const stepDist = Math.hypot(sDx, sDy);
        this.noOdometryDistance += stepDist;
        this.noHomeVector[0] += sDx;
        this.noHomeVector[1] += sDy;
        this.homeHeading = Math.atan2(-this.noHomeVector[1], -this.noHomeVector[0]);
      }

      // Brain 14: Anterior Optic Tubercle (AOTU) Celestial Sun Compass
      if (this.role === "aotu" && peerContext && peerContext.sunAngle !== undefined) {
        this.aotuSunHeading = peerContext.sunAngle;
        let sunDiff = Math.abs(this.compassHeading - this.aotuSunHeading);
        if (sunDiff > Math.PI) sunDiff = 2 * Math.PI - sunDiff;
        this.aotuEVectorAlignment = Math.cos(sunDiff);
      }

      // Brain 15: Superior Medial Protocerebrum (SMP) Action Commitment Latch
      if (this.role === "smp") {
        if (this.smpLatchTimer > 0) {
          this.smpLatchTimer--;
        }
      }

      // 2. Mushroom Body Kenyon Cells Sparse Coding
      for (let k = 0; k < this.KC_BASE_COUNT; k++) {
        let sum = 0;
        const offset = k * this.GLOMERULI_COUNT;
        for (let g = 0; g < this.GLOMERULI_COUNT; g++) {
          sum += this.alProjection[g] * this.alToKcWeights[offset + g];
        }
        this.kcActivations[k] = sum;
      }

      for (let b = 0; b < this.bornNeurons.length; b++) {
        const neuron = this.bornNeurons[b];
        let sum = 0;
        for (let g = 0; g < this.GLOMERULI_COUNT; g++) {
          sum += this.alProjection[g] * neuron.weights[g];
        }
        neuron.activation = sum;
      }

      const allKc = [];
      for (let k = 0; k < this.KC_BASE_COUNT; k++) {
        allKc.push({ isBorn: false, idx: k, val: this.kcActivations[k] });
      }
      for (let b = 0; b < this.bornNeurons.length; b++) {
        allKc.push({ isBorn: true, idx: b, val: this.bornNeurons[b].activation });
      }

      let activeCount = 0;
      if (this.config.mbInhibition === "apl") {
        const apl = this._settleApl(allKc);
        this.aplActivity = apl;
        for (let i = 0; i < allKc.length; i++) {
          const item = allKc[i];
          const inhibited = item.val / (1 + this.config.aplDivisiveGain * apl)
            - this.config.aplSubtractiveGain * apl;
          const actVal = inhibited > 0 ? clamp(inhibited, 0, 1) : 0.0;
          if (actVal > 0) activeCount++;
          if (!item.isBorn) {
            this.kcActivations[item.idx] = actVal;
          } else {
            this.bornNeurons[item.idx].activation = actVal;
          }
        }
      } else {
        allKc.sort((a, b) => b.val - a.val);
        const topK = Math.max(2, Math.floor(allKc.length * 0.15));
        for (let i = 0; i < allKc.length; i++) {
          const item = allKc[i];
          const actVal = i < topK ? clamp(item.val, 0, 1) : 0.0;
          if (actVal > 0) activeCount++;
          if (!item.isBorn) {
            this.kcActivations[item.idx] = actVal;
          } else {
            this.bornNeurons[item.idx].activation = actVal;
          }
        }
        this.aplActivity = 0;
      }
      this.kcSparsity = allKc.length > 0 ? activeCount / allKc.length : 0;

      // 3. MBON Readout
      for (let m = 0; m < this.MBON_COUNT; m++) {
        let sum = 0;
        for (let k = 0; k < this.KC_BASE_COUNT; k++) {
          sum += this.kcActivations[k] * this.kcToMbonWeights[k * this.MBON_COUNT + m];
        }
        for (let b = 0; b < this.bornNeurons.length; b++) {
          const neuron = this.bornNeurons[b];
          sum += neuron.activation * neuron.mbonWeights[m];
        }
        this.mbonActivations[m] = clamp(sum, 0, 2);
      }

      // 4. Central Complex compass.
      //
      // In attractor mode the navigator brain holds the only true compass: a
      // recurrent E-PG ring that integrates angular velocity and is anchored,
      // weakly, to the celestial reference. Other neuropils receive the decoded
      // heading by commissural broadcast, one tick behind, and only draw their
      // readout from it. In kinematic (legacy) mode every brain integrates the
      // same scalar independently and the ring is decorative.
      if (this.config.compass === "attractor" && this.role === "navigator") {
        const sunAnchor = peerContext && Number.isFinite(peerContext.sunAngle)
          ? peerContext.sunAngle
          : null;
        this.updateRingAttractor(headingDelta, sunAnchor, sunAnchor === null ? 0 : 0.045);
        this.compassRing.set(this.epgRing);
      } else {
        if (this.config.compass !== "attractor") {
          this.compassHeading = (this.compassHeading + headingDelta + 2 * Math.PI) % (2 * Math.PI);
        }
        for (let c = 0; c < this.COMPASS_COUNT; c++) {
          const prefAngle = (c / this.COMPASS_COUNT) * 2 * Math.PI;
          let diff = Math.abs(this.compassHeading - prefAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          this.compassRing[c] = Math.exp(-((diff * diff) / (2 * 0.4 * 0.4)));
        }
      }

      // 5. Lateral Horn Innate Avoidance, Giant Fiber (GF) Looming Reflex & Action Geometry
      const actionAngles = [-Math.PI / 2, Math.PI / 2, Math.PI, 0];
      const hazardSense = sensoryInput[3] || 0;
      const hazardAngle = Math.atan2(sensoryInput[8] || 0, sensoryInput[9] || 0);

      // Giant Fiber looming detection (rapid looming expansion or imminent hazard proximity)
      this.loomingVelocity = hazardSense - this.lastHazardSense;
      this.lastHazardSense = hazardSense;
      this.giantFiberTriggered = hazardSense > 0.65 || (hazardSense > 0.35 && this.loomingVelocity > 0.25);
      if (this.giantFiberTriggered) {
        this.smpLatchedAction = -1;
        this.smpLatchTimer = 0;
      }

      // 6. Descending Motor Output Synthesis
      for (let a = 0; a < 4; a++) {
        let diffHeading = Math.abs(this.compassHeading - actionAngles[a]);
        if (diffHeading > Math.PI) diffHeading = 2 * Math.PI - diffHeading;
        const compassBias = 0.25 * Math.cos(diffHeading);

        let mbonDrive = this.mbonActivations[a] || 0;

        let diffHaz = Math.abs(hazardAngle - actionAngles[a]);
        if (diffHaz > Math.PI) diffHaz = 2 * Math.PI - diffHaz;
        const hazAlign = Math.max(0, Math.cos(diffHaz));
        const innateAvoidance = hazardSense * 1.5 * hazAlign;

        // Giant Fiber emergency escape override: explosive drive directly opposite to threat
        if (this.giantFiberTriggered) {
          const escapeAngle = (hazardAngle + Math.PI) % (2 * Math.PI);
          let diffEsc = Math.abs(escapeAngle - actionAngles[a]);
          if (diffEsc > Math.PI) diffEsc = 2 * Math.PI - diffEsc;
          mbonDrive += Math.max(0, Math.cos(diffEsc)) * 3.0;
        }

        if (this.role === "optic") {
          mbonDrive += Math.max(0, this.opticMotionFlow[a]) * 0.8;
        }

        if (this.role === "executive" && this.targetVector && this.targetVector.active) {
          let angleDiff = Math.abs(this.targetVector.heading - actionAngles[a]);
          if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
          const vectorAlignment = Math.max(0, Math.cos(angleDiff));
          mbonDrive += vectorAlignment * 1.8;
        }

        if (this.role === "forager" || this.role === "navigator" || this.role === "metabolic") {
          const leftOdor = sensoryInput[12] || 0;
          const rightOdor = sensoryInput[13] || 0;
          const odorDiff = leftOdor - rightOdor;
          // Bilateral tropotaxis: steer left (a=2) or right (a=3) toward odor gradient
          if (a === 2 && odorDiff > 0.04) mbonDrive += clamp(odorDiff * 1.6, 0, 1.2);
          if (a === 3 && odorDiff < -0.04) mbonDrive += clamp(-odorDiff * 1.6, 0, 1.2);

          // Direct appetitive diamond scent attraction along diamond angle vector
          const diamondSense = sensoryInput[2] || 0;
          if (diamondSense > 0.02) {
            const diamondAngle = Math.atan2(sensoryInput[6] || 0, sensoryInput[7] || 0);
            let diffD = Math.abs(diamondAngle - actionAngles[a]);
            if (diffD > Math.PI) diffD = 2 * Math.PI - diffD;
            mbonDrive += Math.max(0, Math.cos(diffD)) * clamp(diamondSense * 2.2, 0, 2.0);
          }
        }

        if (this.role === "metabolic") {
          mbonDrive *= this.sugarDrive;
        }

        if (this.role === "lal") {
          // LAL bistable turn casting: alternates left (index 2) vs right (index 3) bias
          if (a === 2 && this.lalFlipFlop < 0) mbonDrive += 0.9;
          if (a === 3 && this.lalFlipFlop > 0) mbonDrive += 0.9;
        }

        if (this.role === "vnc_cpg") {
          mbonDrive *= this.vncTorque;
        }

        if (this.role === "ammc" && peerContext) {
          // AMMC peer alignment: gentle attraction/repulsion
          if (peerContext.dist < 2.0) {
            // Repel if too close (prevent collision)
            const repelAngle = Math.atan2(-peerContext.dy, -peerContext.dx);
            let diff = Math.abs(repelAngle - actionAngles[a]);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            mbonDrive += Math.max(0, Math.cos(diff)) * 0.7;
          }
        }

        if (this.role === "pb") {
          // Protocerebral Bridge: bilateral phase-shift steering bias
          if (a === 2 && this.pbPhaseShift < 0) mbonDrive += clamp(-this.pbPhaseShift * 0.9, 0, 1.2);
          if (a === 3 && this.pbPhaseShift > 0) mbonDrive += clamp(this.pbPhaseShift * 0.9, 0, 1.2);
        }

        if (this.role === "eb") {
          // Ellipsoid Body: egocentric landmark anchoring and forward momentum
          if (a === 0 || a === 1) mbonDrive += 0.4 * Math.max(0, this.ebStabilization);
        }

        if (this.role === "no") {
          // Noduli translational odometry: homing drive when energy is low
          const normE = sensoryInput[4] || 0.5;
          if (normE < 0.25) {
            let diff = Math.abs(this.homeHeading - actionAngles[a]);
            if (diff > Math.PI) diff = 2 * Math.PI - diff;
            mbonDrive += Math.max(0, Math.cos(diff)) * 1.3;
          }
        }

        if (this.role === "aotu") {
          // Anterior Optic Tubercle: polarized celestial skylight navigation
          mbonDrive += Math.max(0, this.aotuEVectorAlignment) * 0.6;
        }

        if (this.role === "smp") {
          // Superior Medial Protocerebrum: Action commitment latching
          if (this.smpLatchedAction >= 0 && this.smpLatchTimer > 0) {
            if (a === this.smpLatchedAction) mbonDrive += 1.1;
          }
        }

        const vigor = (0.8 + this.octopamineOA * 0.4) * (this.pdfArousal || 1.0);
        this.descendingOutputs[a] = (mbonDrive + compassBias - innateAvoidance) * vigor;
      }

      return this.descendingOutputs;
    }

    applyPlasticity(rewardDelta, hazardDelta) {
      this.dopaminePAM = clamp(rewardDelta, 0, 2);
      this.dopaminePPL1 = clamp(hazardDelta, 0, 2);

      if (this.config.plasticity === "dan-ltd") {
        this._applyDopamineGatedDepression();
        return;
      }

      const netModulation = (this.dopaminePAM * 1.2) - (this.dopaminePPL1 * 1.5);
      const learningRate = 0.05 * (0.8 + this.serotonin5HT * 0.4);
      const decay = 0.001;

      for (let k = 0; k < this.KC_BASE_COUNT; k++) {
        const pre = this.kcActivations[k];
        if (pre < 0.01) continue;

        for (let m = 0; m < this.MBON_COUNT; m++) {
          const post = this.mbonActivations[m];
          const idx = k * this.MBON_COUNT + m;
          this.eligibilityTraces[idx] = 0.8 * this.eligibilityTraces[idx] + pre * post;
          const deltaW = learningRate * this.eligibilityTraces[idx] * netModulation;
          this.kcToMbonWeights[idx] = clamp(this.kcToMbonWeights[idx] + deltaW - decay * this.kcToMbonWeights[idx], 0.01, 2.0);
        }
      }

      for (let b = 0; b < this.bornNeurons.length; b++) {
        const neuron = this.bornNeurons[b];
        const pre = neuron.activation;
        if (pre < 0.01) continue;

        for (let m = 0; m < this.MBON_COUNT; m++) {
          const post = this.mbonActivations[m];
          const deltaW = learningRate * (pre * post) * netModulation;
          neuron.mbonWeights[m] = clamp(neuron.mbonWeights[m] + deltaW - decay * neuron.mbonWeights[m], 0.01, 2.0);
        }
      }
    }

    /**
     * Dopamine-gated, depression-dominant plasticity at KC->MBON synapses.
     *
     * Coincidence of Kenyon-cell activity with dopaminergic input depresses the
     * synapse, which is how olfactory learning is expressed in the mushroom
     * body: the readout is the difference between MBON channels, so weakening
     * one channel strengthens the alternative. Here punishment (PPL1) depresses
     * the channel that was actually taken, and reward (PAM) depresses the
     * channels that were not, with a smaller potentiation of the taken channel
     * for the bidirectional component. Depressed synapses recover slowly toward
     * baseline, which is this model's forgetting term.
     */
    _applyDopamineGatedDepression() {
      const cfg = this.config;
      const rate = cfg.ltdRate * (0.8 + this.serotonin5HT * 0.4);
      const action = this.lastActionIndex;
      const pam = this.dopaminePAM;
      const ppl1 = this.dopaminePPL1;
      const baseline = cfg.kcMbonBaseline;
      const recovery = cfg.ltdRecovery;

      const applyToRow = (pre, readWeight, writeWeight, traceIndex) => {
        for (let m = 0; m < this.MBON_COUNT; m++) {
          const taken = action < 0 || m === action;
          let trace = pre;
          if (traceIndex >= 0) {
            const idx = traceIndex + m;
            this.eligibilityTraces[idx] = 0.8 * this.eligibilityTraces[idx] + pre;
            trace = clamp(this.eligibilityTraces[idx], 0, 4);
          }

          let delta = 0;
          if (ppl1 > 0) delta -= (taken ? ppl1 : ppl1 * 0.25) * rate * trace;
          if (pam > 0) {
            delta -= (taken ? 0 : pam * 0.5) * rate * trace;
            if (taken) delta += pam * rate * 0.45 * trace;
          }

          const current = readWeight(m);
          const recovered = current + recovery * (baseline - current);
          writeWeight(m, clamp(recovered + delta, 0.01, 2.0));
        }
      };

      for (let k = 0; k < this.KC_BASE_COUNT; k++) {
        const pre = this.kcActivations[k];
        if (pre < 0.01) continue;
        const rowBase = k * this.MBON_COUNT;
        applyToRow(
          pre,
          m => this.kcToMbonWeights[rowBase + m],
          (m, v) => { this.kcToMbonWeights[rowBase + m] = v; },
          rowBase
        );
      }

      for (let b = 0; b < this.bornNeurons.length; b++) {
        const neuron = this.bornNeurons[b];
        const pre = neuron.activation;
        if (pre < 0.01) continue;
        applyToRow(pre, m => neuron.mbonWeights[m], (m, v) => { neuron.mbonWeights[m] = v; }, -1);
      }
    }

    applyHomeostaticScaling(targetMean = 0.25) {
      let sumW = 0;
      for (let i = 0; i < this.kcToMbonWeights.length; i++) {
        sumW += this.kcToMbonWeights[i];
      }
      const currentMean = sumW / this.kcToMbonWeights.length;
      if (currentMean > 0.01) {
        const scale = 0.95 * 1.0 + 0.05 * (targetMean / currentMean);
        for (let i = 0; i < this.kcToMbonWeights.length; i++) {
          this.kcToMbonWeights[i] = clamp(this.kcToMbonWeights[i] * scale, 0.01, 2.0);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Dynamic Algorithmic Neurogenesis Engine
  // -------------------------------------------------------------
  class NeurogenesisEngine {
    /**
     * @param {number} maxBornPerBrain
     * @param {MulberryPRNG} [prng] - seeded stream for birth weights. Supplied by
     *   the syncytium so that two runs from the same world seed grow identical
     *   Kenyon cells; without it the pool would depend on Math.random().
     */
    constructor(maxBornPerBrain = 24, prng = null) {
      this.maxBornPerBrain = maxBornPerBrain;
      this.noveltyThreshold = 0.25;
      this.mitosisCount = 0;
      this.apoptosisCount = 0;
      this.birthCounter = 0;
      this.prng = prng || new MulberryPRNG(0x5eed1e55);
    }

    evaluate(brain, noveltyError, agentEnergy) {
      for (let i = brain.bornNeurons.length - 1; i >= 0; i--) {
        const neuron = brain.bornNeurons[i];
        neuron.age++;
        if (neuron.maturity < 1.0) {
          neuron.maturity = Math.min(1.0, neuron.maturity + 0.05);
        }

        if (neuron.age > 100 && neuron.activation < 0.01 && neuron.maturity < 0.5) {
          brain.bornNeurons.splice(i, 1);
          this.apoptosisCount++;
        }
      }

      if (noveltyError > this.noveltyThreshold && brain.bornNeurons.length < this.maxBornPerBrain) {
        if (agentEnergy > 20) {
          this._spawnKenyonCell(brain);
          this.mitosisCount++;
        }
      }
    }

    _spawnKenyonCell(brain) {
      const rng = this.prng;
      const id = `${brain.id}_born_${this.birthCounter++}`;
      const weights = new Float32Array(brain.GLOMERULI_COUNT);
      for (let i = 0; i < 3; i++) {
        const g = rng.int(brain.GLOMERULI_COUNT);
        weights[g] = 0.3 + rng.next() * 0.4;
      }

      const mbonWeights = new Float32Array(brain.MBON_COUNT);
      for (let m = 0; m < brain.MBON_COUNT; m++) {
        mbonWeights[m] = 0.2 + rng.next() * 0.1;
      }

      brain.bornNeurons.push({
        id,
        age: 0,
        maturity: 0.1,
        activation: 0,
        weights,
        mbonWeights
      });
    }
  }

  // -------------------------------------------------------------
  // Offline Pre-Training Engine
  // -------------------------------------------------------------
  class PreTrainingEngine {
    static runPreTraining(syncytium, epochs = 60, onProgress = null) {
      const prng = new MulberryPRNG(syncytium.worldSeed || 101);

      for (let ep = 0; ep < epochs; ep++) {
        const sensory = [
          prng.next(), prng.next(),
          prng.next() * 0.8, prng.next() * 0.5,
          0.5 + prng.next() * 0.5, prng.next(),
          0, 0,
          0, 0,
          0, 0, 0, 0
        ];

        const headingShift = (Math.PI * 2 / epochs) * (ep % 8);
        syncytium.step(sensory, headingShift, 0.05, 90);

        for (let b = 0; b < syncytium.brainCount; b++) {
          const brain = syncytium.brains[b];
          for (let k = 0; k < brain.KC_BASE_COUNT; k++) {
            const preAct = brain.kcActivations[k];
            if (preAct > 0.2) {
              const offset = k * brain.GLOMERULI_COUNT;
              for (let g = 0; g < brain.GLOMERULI_COUNT; g++) {
                brain.alToKcWeights[offset + g] = clamp(brain.alToKcWeights[offset + g] + 0.005 * brain.alProjection[g], 0.1, 1.2);
              }
            }
          }
        }

        if (onProgress && ep % 10 === 0) {
          onProgress(Math.round(((ep + 1) / epochs) * 100));
        }
      }

      syncytium.isPretrained = true;
      syncytium.pretrainingEpochs = epochs;
      if (onProgress) onProgress(100);
      return syncytium;
    }
  }

  // -------------------------------------------------------------
  // Sixteen-Fly-Brain Syncytium Connectome
  // Interconnects 16 specialized fly brains with 16x16x4 commissural bridges (1024 synapses)
  // -------------------------------------------------------------
  class SixteenFlyBrainSyncytium {
    /**
     * @param {number|string} worldSeed
     * @param {object|string|null} [config] - mechanism selection, or the string
     *   "legacy" for the pre-upgrade circuit models. See DEFAULT_CONFIG.
     */
    constructor(worldSeed = 42, config = null) {
      this.worldSeed = worldSeed;
      this.prng = new MulberryPRNG(worldSeed);
      this.config = resolveConfig(config);

      // 16 Specialized biological roles (grounded in malecns and Central Complex connectomics)
      this.roles = [
        "forager",    // Brain 0: Antennal Lobe & PAM appetitive reward
        "navigator",  // Brain 1: Central Complex E-PG compass ring
        "sentinel",   // Brain 2: Lateral Horn threat reflex & PPL1 aversion
        "vault",      // Brain 3: Kenyon Cell associative LTM engrams
        "pioneer",    // Brain 4: Neurogenesis mitosis hub & novelty exploration
        "optic",      // Brain 5: Optic Lobe motion flow & visual contrast
        "executive",  // Brain 6: Central Complex Fan-Shaped Body (FB) vector planner
        "metabolic",  // Brain 7: Subesophageal Zone (SEZ) taste & satiety drive
        "lal",        // Brain 8: Lateral Accessory Lobe flip-flop zigzag casting
        "vnc_cpg",    // Brain 9: Ventral Nerve Cord CPG locomotion rhythm & torque
        "ammc",       // Brain 10: Johnston's Organ AMMC mechanosensory & peer vibration
        "pb",         // Brain 11: Protocerebral Bridge bilateral phase-shift steering
        "eb",         // Brain 12: Ellipsoid Body toroidal landmark ring attractor
        "no",         // Brain 13: Noduli odometry & path integration translational memory
        "aotu",       // Brain 14: Anterior Optic Tubercle celestial sun compass
        "smp"         // Brain 15: Superior Medial Protocerebrum action commitment latch
      ];

      this.brainCount = 16;
      this.brains = [];
      for (let i = 0; i < this.brainCount; i++) {
        this.brains.push(new DrosophilaBrain(i, this.roles[i], this.config));
      }

      // Forked so neurogenesis draws cannot shift any other seeded stream.
      this.neurogenesis = new NeurogenesisEngine(24, this.prng.fork(1));
      this.commissuralWeights = this._initCommissuralWeights();

      this.engramBank = [];
      this.lastEstimatedValue = 0;
      this.tdGamma = 0.85;
      this.lastRPE = 0;
      this.lastActionIndex = -1;
      this.syncytiumSteps = 0;
      this.isPretrained = false;
      this.pretrainingEpochs = 0;

      // Circadian Clock (120-tick period) & PDF (Pigment-Dispersing Factor)
      this.circadianClock = 0;
      this.circadianPeriod = 120;
      this.pdfArousal = 1.0;

      // Environment ticks, distinct from forward passes. One tick may contain
      // several forward passes (one per fly), so the clock and the homeostatic
      // schedule are driven from tickCount rather than from syncytiumSteps.
      this.tickCount = 0;
      this._tickOpen = false;
      this._tickAuto = false;

      // Shared connectome, separate bodies: one ego record per fly holds the
      // registers that must not leak between individuals.
      this.egoStates = new Map();
      this._pristineEgo = this.brains.map(b => b.captureEgo());
      this.activeEgoId = null;
    }

    /**
     * Open an environment tick: advance the circadian clock and run the
     * homeostatic schedule exactly once, however many flies step afterwards.
     */
    beginTick() {
      this._advanceTick();
      this._tickOpen = true;
      this._tickAuto = false;
      return this;
    }

    /** Close a tick opened by beginTick. */
    endTick() {
      this._tickOpen = false;
      this._tickAuto = false;
      return this;
    }

    _advanceTick() {
      this.tickCount++;
      this.circadianClock = (this.circadianClock + 1) % this.circadianPeriod;
      const isDay = this.circadianClock < this.circadianPeriod / 2;
      this.pdfArousal = isDay
        ? 1.0 + 0.25 * Math.sin((this.circadianClock / (this.circadianPeriod / 2)) * Math.PI)
        : 0.65;
      if (this.tickCount % 50 === 0) {
        for (let i = 0; i < this.brainCount; i++) this.brains[i].applyHomeostaticScaling(0.25);
      }
    }

    _egoRecord(egoId) {
      let record = this.egoStates.get(egoId);
      if (!record) {
        // A new fly starts from the pristine registers, not from whichever
        // individual happened to step last.
        record = this._pristineEgo.map(ego => ({
          scalars: Object.assign(Object.create(null), ego.scalars),
          arrays: Object.fromEntries(Object.entries(ego.arrays).map(([k, v]) => [k, Float32Array.from(v)])),
          born: Float32Array.from(ego.born)
        }));
        this.egoStates.set(egoId, record);
      }
      return record;
    }

    /** Swap a fly's registers into the shared brains. */
    loadEgo(egoId) {
      if (egoId === null || egoId === undefined) return this;
      const record = this._egoRecord(egoId);
      for (let i = 0; i < this.brains.length; i++) this.brains[i].restoreEgo(record[i]);
      this.activeEgoId = egoId;
      return this;
    }

    /** Copy the shared brains' current registers back into a fly's record. */
    saveEgo(egoId) {
      if (egoId === null || egoId === undefined) return this;
      const record = this._egoRecord(egoId);
      for (let i = 0; i < this.brains.length; i++) this.brains[i].captureEgo(record[i]);
      return this;
    }

    _initCommissuralWeights() {
      const weights = new Float32Array(16 * 16 * 4);
      for (let src = 0; src < 16; src++) {
        for (let dst = 0; dst < 16; dst++) {
          if (src === dst) continue;
          for (let a = 0; a < 4; a++) {
            const idx = (src * 16 + dst) * 4 + a;
            weights[idx] = 0.08;
          }
        }
      }
      return weights;
    }

    _computeExecutiveGoalVector(sensoryInput) {
      if (this.engramBank.length > 0) {
        let bestEngram = this.engramBank[0];
        for (let i = 1; i < this.engramBank.length; i++) {
          if (this.engramBank[i].salience > bestEngram.salience) {
            bestEngram = this.engramBank[i];
          }
        }

        const agentX = sensoryInput[0] || 0.5;
        const agentY = sensoryInput[1] || 0.5;
        const targetX = bestEngram.targetX !== undefined ? bestEngram.targetX : 0.8;
        const targetY = bestEngram.targetY !== undefined ? bestEngram.targetY : 0.8;

        const dx = targetX - agentX;
        const dy = targetY - agentY;
        const distance = Math.hypot(dx, dy);
        const heading = Math.atan2(dy, dx);

        return { x: dx, y: dy, distance, heading, active: distance > 0.05 };
      }

      const diamondSense = sensoryInput[2] || 0;
      if (diamondSense > 0.02) {
        const diamondAngle = Math.atan2(sensoryInput[6] || 0, sensoryInput[7] || 0);
        return { x: Math.cos(diamondAngle), y: Math.sin(diamondAngle), distance: 1.0, heading: diamondAngle, active: true };
      }

      return { x: 0, y: 0, distance: 0, heading: 0, active: false };
    }

    /**
     * One forward pass through the syncytium for a single fly.
     *
     * @param {ArrayLike<number>} sensoryInput - 14-channel sensory vector
     * @param {number} headingDelta - angular velocity for the compass
     * @param {number} noveltyError - drives neurogenesis
     * @param {number} agentEnergy - metabolic budget
     * @param {object|null} peerContext - peer geometry, sun angle, step vector
     * @param {*} [egoId] - identifies the fly; its registers are swapped in and
     *   out so several flies can share one connectome without leaking heading,
     *   odometry, gait phase or metabolic state into each other. Omit for the
     *   single-fly case.
     */
    step(sensoryInput, headingDelta = 0, noveltyError = 0, agentEnergy = 100, peerContext = null, egoId = null) {
      this.syncytiumSteps++;

      // A caller that never opens a tick explicitly (the single-fly case) gets
      // one tick per forward pass, as before.
      if (!this._tickOpen) {
        this._advanceTick();
        this._tickAuto = true;
      }
      const isDay = this.circadianClock < this.circadianPeriod / 2;

      if (egoId !== null && egoId !== undefined) this.loadEgo(egoId);

      const execContext = this._computeExecutiveGoalVector(sensoryInput);

      // 1. Forward pass for each of the 16 brains
      const individualOutputs = [];
      for (let i = 0; i < this.brainCount; i++) {
        const brain = this.brains[i];
        brain.pdfArousal = this.pdfArousal;

        // Day promotes octopaminergic vigor; night promotes serotonergic memory consolidation
        if (isDay) {
          brain.octopamineOA = clamp(brain.octopamineOA * 1.005, 0.1, 1.2);
        } else {
          brain.serotonin5HT = clamp(brain.serotonin5HT * 1.005, 0.1, 1.2);
        }

        const modulatedSensory = sensoryInput.slice();
        if (brain.role === "forager") {
          modulatedSensory[4] = (modulatedSensory[4] || 0) * 1.3;
        } else if (brain.role === "sentinel") {
          modulatedSensory[3] = (modulatedSensory[3] || 0) * 1.5;
        }

        const out = brain.forward(modulatedSensory, headingDelta, execContext, peerContext);
        individualOutputs.push(out);

        this.neurogenesis.evaluate(brain, noveltyError, agentEnergy);
      }

      // 2. Inter-Brain Commissural Cross-Talk (16x16x4 = 1024 synapses)
      const commInteractions = Array.from({ length: this.brainCount }, () => new Float32Array(4));
      for (let src = 0; src < this.brainCount; src++) {
        for (let dst = 0; dst < this.brainCount; dst++) {
          if (src === dst) continue;
          for (let a = 0; a < 4; a++) {
            const w = this.commissuralWeights[(src * 16 + dst) * 4 + a];
            commInteractions[dst][a] += individualOutputs[src][a] * w;
          }
        }
      }

      // 3. Heading distribution.
      //
      // Attractor mode broadcasts the navigator's decoded heading, because the
      // compass lives in the Central Complex and other neuropils read it.
      // Averaging scalars from 16 independent integrators, as legacy mode does,
      // also wraps incorrectly near 0/2pi -- a mean of 0.01 and 6.27 lands at
      // pi, pointing backwards.
      if (this.config.compass === "attractor") {
        const reference = this.brains[1].compassHeading;
        for (let i = 0; i < this.brainCount; i++) {
          if (i === 1) continue;
          const brain = this.brains[i];
          brain.compassHeading = wrapAngle(
            brain.compassHeading + 0.6 * angleDelta(reference, brain.compassHeading)
          );
        }
      } else {
        let meanHeading = 0;
        for (let i = 0; i < this.brainCount; i++) {
          meanHeading += this.brains[i].compassHeading;
        }
        meanHeading /= this.brainCount;
        for (let i = 0; i < this.brainCount; i++) {
          this.brains[i].compassHeading = 0.85 * this.brains[i].compassHeading + 0.15 * meanHeading;
        }
      }

      // 4. Consensus Motor Synthesis (16 Brains)
      const roleWeights = {
        forager: 1.2,
        navigator: 1.1,
        sentinel: 1.4,
        vault: 1.0,
        pioneer: 0.9,
        optic: 1.15,
        executive: 1.35,
        metabolic: 1.25,
        lal: 1.1,
        vnc_cpg: 1.05,
        ammc: 1.15,
        pb: 1.2,
        eb: 1.15,
        no: 1.05,
        aotu: 1.1,
        smp: 1.3
      };

      const consensusLogits = [0, 0, 0, 0];
      for (let i = 0; i < this.brainCount; i++) {
        const brain = this.brains[i];
        const rW = roleWeights[brain.role] || 1.0;
        for (let a = 0; a < 4; a++) {
          const direct = individualOutputs[i][a];
          const cross = commInteractions[i][a];
          consensusLogits[a] += (direct + 0.2 * cross) * rW;
        }
      }

      this.lastEstimatedValue = (consensusLogits[0] + consensusLogits[1] + consensusLogits[2] + consensusLogits[3]) / 4;

      // The channel the consensus favoured. Dopamine-gated depression needs it
      // to know which KC->MBON synapses coincided with the outcome.
      let chosen = 0;
      for (let a = 1; a < 4; a++) if (consensusLogits[a] > consensusLogits[chosen]) chosen = a;
      this.lastActionIndex = chosen;
      for (let i = 0; i < this.brainCount; i++) this.brains[i].lastActionIndex = chosen;

      if (egoId !== null && egoId !== undefined) this.saveEgo(egoId);
      if (this._tickAuto) {
        this._tickOpen = false;
        this._tickAuto = false;
      }

      return softmax(consensusLogits);
    }

    /**
     * @param {number} rewardDelta
     * @param {number} hazardDelta
     * @param {object|null} currentCoordinates
     * @param {*} [egoId] - the fly being credited. Plasticity reads the KC and
     *   MBON activations that produced the action, so crediting a shared
     *   connectome without naming the fly would train whichever individual
     *   stepped last.
     */
    applyReinforcement(rewardDelta, hazardDelta, currentCoordinates = null, egoId = null) {
      if (egoId !== null && egoId !== undefined) this.loadEgo(egoId);
      const netExtrinsic = rewardDelta - (hazardDelta * 1.5);
      const rpe = netExtrinsic + (this.tdGamma * this.lastEstimatedValue * 0.1) - (this.lastEstimatedValue * 0.1);
      this.lastRPE = rpe;

      const pamBurst = Math.max(0, rpe > 0 ? rpe : rewardDelta);
      const ppl1Burst = Math.max(0, rpe < 0 ? Math.abs(rpe) : hazardDelta);

      for (let i = 0; i < this.brainCount; i++) {
        this.brains[i].applyPlasticity(pamBurst, ppl1Burst);
      }

      if (rewardDelta > 0.4 || pamBurst > 0.5) {
        this._consolidateEngram(Math.max(rewardDelta, pamBurst), currentCoordinates);
      }

      if (egoId !== null && egoId !== undefined) this.saveEgo(egoId);
    }

    _consolidateEngram(salience, coords = null) {
      const engram = {
        step: this.syncytiumSteps,
        salience,
        compassMean: this.brains[1].compassHeading,
        activeKCs: this.brains[3].kcActivations.slice(0, 10),
        targetX: coords ? coords.x : 0.8,
        targetY: coords ? coords.y : 0.8,
        valence: salience
      };

      this.engramBank.push(engram);
      if (this.engramBank.length > 64) {
        this.engramBank.shift();
      }
    }

    getTelemetry() {
      let totalBornNeurons = 0;
      let totalMatureNeurons = 0;
      for (let i = 0; i < this.brainCount; i++) {
        totalBornNeurons += this.brains[i].bornNeurons.length;
        for (const n of this.brains[i].bornNeurons) {
          if (n.maturity >= 0.9) totalMatureNeurons++;
        }
      }

      return {
        step: this.syncytiumSteps,
        worldSeed: this.worldSeed,
        brainCount: this.brainCount,
        isPretrained: this.isPretrained,
        pretrainingEpochs: this.pretrainingEpochs,
        totalBornNeurons,
        totalMatureNeurons,
        mitosisEvents: this.neurogenesis.mitosisCount,
        apoptosisEvents: this.neurogenesis.apoptosisCount,
        engramsStored: this.engramBank.length,
        compassHeadingDeg: Math.round((this.brains[1].compassHeading * 180) / Math.PI),
        brainRoles: this.brains.map(b => b.role),
        dopaminePAM: this.brains[0].dopaminePAM,
        dopaminePPL1: this.brains[2].dopaminePPL1,
        octopamineOA: this.brains[7].octopamineOA,
        serotonin5HT: this.brains[7].serotonin5HT,
        lastRPE: this.lastRPE,
        executiveVectorActive: this.brains[6].targetVector?.active || false,
        lalFlipFlop: this.brains[8].lalFlipFlop,
        vncTorque: this.brains[9].vncTorque,
        ammcVibration: this.brains[10].ammcVibration,
        pbPhaseShift: this.brains[11].pbPhaseShift,
        ebStabilization: this.brains[12].ebStabilization,
        noDistance: this.brains[13].noOdometryDistance,
        aotuSunHeading: this.brains[14].aotuSunHeading,
        aotuEVectorAlignment: this.brains[14].aotuEVectorAlignment,
        smpLatchedAction: this.brains[15].smpLatchedAction,
        neuropeptideNPF: this.brains[7].neuropeptideNPF || 0,
        neuropeptideSIFamide: this.brains[7].neuropeptideSIFamide || 0,
        giantFiberTriggered: this.brains[2].giantFiberTriggered || false,
        loomingVelocity: this.brains[2].loomingVelocity || 0,
        circadianClock: this.circadianClock,
        circadianPhase: this.circadianClock < this.circadianPeriod / 2 ? "DAY" : "NIGHT",
        pdfArousal: this.pdfArousal,
        tick: this.tickCount,
        activeEgoId: this.activeEgoId,
        compassMode: this.config.compass,
        mbInhibition: this.config.mbInhibition,
        plasticityRule: this.config.plasticity,
        // Population-vector length of the E-PG bump: 1 is a sharp, confident
        // heading estimate, 0 a flat ring with no heading at all.
        ringCertainty: this.brains[1].ringCertainty,
        ringAmplitude: this.brains[1].ringAmplitude,
        epgRing: Array.from(this.brains[1].epgRing),
        kcSparsity: this.brains[3].kcSparsity,
        aplActivity: this.brains[3].aplActivity,
        lastActionIndex: this.lastActionIndex
      };
    }

    getSyncytiumTelemetry() {
      return this.getTelemetry();
    }
  }

  // Aliases for full backward compatibility
  const ElevenFlyBrainSyncytium = SixteenFlyBrainSyncytium;
  const EightFlyBrainSyncytium = SixteenFlyBrainSyncytium;
  const SevenFlyBrainSyncytium = SixteenFlyBrainSyncytium;
  const FiveFlyBrainSyncytium = SixteenFlyBrainSyncytium;

  // -------------------------------------------------------------
  // Dual-Agent Graph Grafting with Stagnation Inactivity Hazard
  // -------------------------------------------------------------
  // Stable ego identifiers so the same fly always maps to the same registers.
  const EGO_AGENT1 = "agent1";
  const EGO_AGENT2 = "agent2";
  const EGO_AGENT3 = "agent3";

  class MultiAgentGraphGraft {
    /**
     * @param {SixteenFlyBrainSyncytium} syncytium
     * @param {number} graftInfluence
     */
    constructor(syncytium = null, graftInfluence = 0.55) {
      this.syncytium = syncytium || new SixteenFlyBrainSyncytium(42);
      this.graftInfluence = clamp(graftInfluence, 0, 1);
      this.actionNames = ["up", "down", "left", "right"];
      this.sunAngle = 0;

      // Agent 1: Harvester (Appetitive forage specialist)
      this.agent1 = {
        id: 1,
        name: "Harvester",
        role: "harvester",
        behavioralRegime: "FORAGE",
        dwellTicks: 0,
        lastX: -1,
        lastY: -1,
        committedAction: -1,
        commitmentTimer: 0,
        isStasisHazard: false,
        lastFlyProbabilities: [0.25, 0.25, 0.25, 0.25],
        lastHeading: 0
      };

      // Agent 2: Sentinel-Pioneer (Frontier exploration & hazard sweep)
      this.agent2 = {
        id: 2,
        name: "Sentinel-Pioneer",
        role: "sentinel_pioneer",
        behavioralRegime: "PIONEER",
        dwellTicks: 0,
        lastX: -1,
        lastY: -1,
        committedAction: -1,
        commitmentTimer: 0,
        isStasisHazard: false,
        isGFEscape: false,
        lastFlyProbabilities: [0.25, 0.25, 0.25, 0.25],
        lastHeading: 0
      };

      // Agent 3: Cartographer-Scout (Spatial mapping, celestial scouts, and beacon planting)
      this.agent3 = {
        id: 3,
        name: "Cartographer-Scout",
        role: "cartographer",
        behavioralRegime: "SCOUT",
        dwellTicks: 0,
        lastX: -1,
        lastY: -1,
        committedAction: -1,
        commitmentTimer: 0,
        isStasisHazard: false,
        isGFEscape: false,
        lastFlyProbabilities: [0.25, 0.25, 0.25, 0.25],
        lastHeading: 0
      };

      this.stasisThreshold = 4; // Stagnation hazard triggers after 4 still ticks
      this.stasisEnergyDrain = 8;
      this.stasisEvents = 0;
      this.handshakeEvents = 0; // AMMC acoustic synergy events
      this.triSwarmResonanceEvents = 0; // Triangular 3-agent acoustic swarm events
      this.giantFiberEvents = 0; // Giant Fiber emergency looming escape saccades
      this.beaconWaypoints = []; // Cartographer luminescent beacon waypoints
    }

    _updateAgentRegime(agentData, sensoryState) {
      const hazardSense = sensoryState[3] || 0;
      const energyNorm = sensoryState[4] || 0.5;
      const rewardSense = sensoryState[2] || 0;

      if (hazardSense > 0.45) {
        agentData.behavioralRegime = "EVADE";
      } else if (agentData.role === "cartographer") {
        agentData.behavioralRegime = rewardSense > 0.3 ? "MAP_BEACON" : "SCOUT";
      } else if (energyNorm < 0.35 || (agentData.role === "harvester" && rewardSense > 0.3)) {
        agentData.behavioralRegime = "FORAGE";
      } else if (sensoryState[5] < 0.25 || agentData.role === "sentinel_pioneer") {
        agentData.behavioralRegime = "PIONEER";
      } else {
        agentData.behavioralRegime = "CONSOLIDATE";
      }
    }

    /**
     * Resolve actions for agents (supporting dual and tri-agent swarms) with inter-agent graph communication,
     * triangular swarm resonance, beacon planting, and Giant Fiber looming escapes.
     */
    resolveAgents(
      env,
      agent1Obs,
      agent2Obs,
      agent3Obs = null,
      agent1Logits = [0.25, 0.25, 0.25, 0.25],
      agent2Logits = [0.25, 0.25, 0.25, 0.25],
      agent3Logits = [0.25, 0.25, 0.25, 0.25]
    ) {
      // One environment tick, however many flies are resolved inside it.
      this.syncytium.beginTick();

      // 1. Calculate Inter-Agent Graph Metrics & Celestial Sun Angle
      const dx12 = env.agent2X - env.agent1X;
      const dy12 = env.agent2Y - env.agent1Y;
      const peerDist = Math.hypot(dx12, dy12);
      const dist12 = peerDist;

      const hasAgent3 = Boolean(agent3Obs && env.agent3X !== undefined && env.agent3Y !== undefined);
      let dist23 = 999, dist31 = 999;
      let dx23 = 0, dy23 = 0, dx31 = 0, dy31 = 0;

      if (hasAgent3) {
        dx23 = env.agent3X - env.agent2X;
        dy23 = env.agent3Y - env.agent2Y;
        dist23 = Math.hypot(dx23, dy23);

        dx31 = env.agent1X - env.agent3X;
        dy31 = env.agent1Y - env.agent3Y;
        dist31 = Math.hypot(dx31, dy31);
      }

      const sunAngle = (this.syncytium.circadianClock / this.syncytium.circadianPeriod) * Math.PI * 2;
      this.sunAngle = sunAngle;

      const stepDx1 = this.agent1.lastX >= 0 ? env.agent1X - this.agent1.lastX : 0;
      const stepDy1 = this.agent1.lastY >= 0 ? env.agent1Y - this.agent1.lastY : 0;
      const stepDx2 = this.agent2.lastX >= 0 ? env.agent2X - this.agent2.lastX : 0;
      const stepDy2 = this.agent2.lastY >= 0 ? env.agent2Y - this.agent2.lastY : 0;
      const stepDx3 = hasAgent3 && this.agent3.lastX >= 0 ? env.agent3X - this.agent3.lastX : 0;
      const stepDy3 = hasAgent3 && this.agent3.lastY >= 0 ? env.agent3Y - this.agent3.lastY : 0;

      // 2. Check Stagnation Dwell Times for Agent 1
      if (env.agent1X === this.agent1.lastX && env.agent1Y === this.agent1.lastY) {
        this.agent1.dwellTicks++;
      } else {
        this.agent1.dwellTicks = 0;
      }
      this.agent1.lastX = env.agent1X;
      this.agent1.lastY = env.agent1Y;
      this.agent1.isStasisHazard = this.agent1.dwellTicks >= this.stasisThreshold;
      if (this.agent1.isStasisHazard) {
        this.stasisEvents++;
        env.agent1Energy = Math.max(0, env.agent1Energy - this.stasisEnergyDrain);
        this.syncytium.applyReinforcement(0, 1.2, null, EGO_AGENT1);
      }

      // Check Stagnation Dwell Times for Agent 2
      if (env.agent2X === this.agent2.lastX && env.agent2Y === this.agent2.lastY) {
        this.agent2.dwellTicks++;
      } else {
        this.agent2.dwellTicks = 0;
      }
      this.agent2.lastX = env.agent2X;
      this.agent2.lastY = env.agent2Y;
      this.agent2.isStasisHazard = this.agent2.dwellTicks >= this.stasisThreshold;
      if (this.agent2.isStasisHazard) {
        this.stasisEvents++;
        env.agent2Energy = Math.max(0, env.agent2Energy - this.stasisEnergyDrain);
        this.syncytium.applyReinforcement(0, 1.2, null, EGO_AGENT2);
      }

      // Check Stagnation Dwell Times for Agent 3
      if (hasAgent3) {
        if (env.agent3X === this.agent3.lastX && env.agent3Y === this.agent3.lastY) {
          this.agent3.dwellTicks++;
        } else {
          this.agent3.dwellTicks = 0;
        }
        this.agent3.lastX = env.agent3X;
        this.agent3.lastY = env.agent3Y;
        this.agent3.isStasisHazard = this.agent3.dwellTicks >= this.stasisThreshold;
        if (this.agent3.isStasisHazard) {
          this.stasisEvents++;
          if (env.agent3Energy !== undefined) {
            env.agent3Energy = Math.max(0, env.agent3Energy - this.stasisEnergyDrain);
          }
          this.syncytium.applyReinforcement(0, 1.2, null, EGO_AGENT3);
        }
      }

      // 3. Resolve Agent 1 (Harvester)
      this._updateAgentRegime(this.agent1, agent1Obs);
      const h1 = Math.atan2(agent1Obs[1] - 0.5, agent1Obs[0] - 0.5);
      const flyProbs1 = this.syncytium.step(agent1Obs, h1 - this.agent1.lastHeading, 0, env.agent1Energy, {
        dx: dx12, dy: dy12, dist: peerDist, sunAngle, stepDx: stepDx1, stepDy: stepDy1
      }, EGO_AGENT1);
      this.agent1.lastHeading = h1;
      this.agent1.lastFlyProbabilities = flyProbs1;

      // Giant fiber check for Agent 1
      this.agent1.isGFEscape = Boolean(agent1Obs[3] > 0.65 || (agent1Obs[3] > 0.35 && this.syncytium.brains[2].loomingVelocity > 0.25));
      if (this.agent1.isGFEscape) {
        this.giantFiberEvents++;
        this.agent1.commitmentTimer = 0;
      }

      const dynamicBeta1 = clamp(this.graftInfluence + (this.agent1.behavioralRegime === "EVADE" ? 0.25 : 0.1), 0.1, 0.95);
      const combProbs1 = [0, 0, 0, 0];
      for (let a = 0; a < 4; a++) {
        combProbs1[a] = (1 - dynamicBeta1) * agent1Logits[a] + dynamicBeta1 * flyProbs1[a];
      }
      const finalProbs1 = softmax(combProbs1, 0.8);
      let maxA1 = 0;
      for (let a = 1; a < 4; a++) if (finalProbs1[a] > finalProbs1[maxA1]) maxA1 = a;

      if (this.agent1.isGFEscape) {
        this.agent1.committedAction = maxA1;
        this.agent1.commitmentTimer = 0;
      } else if (this.agent1.commitmentTimer > 0 && this.agent1.behavioralRegime !== "EVADE") {
        this.agent1.commitmentTimer--;
        maxA1 = this.agent1.committedAction;
      } else {
        this.agent1.committedAction = maxA1;
        this.agent1.commitmentTimer = 2;
      }

      // 4. Resolve Agent 2 (Sentinel-Pioneer)
      this._updateAgentRegime(this.agent2, agent2Obs);
      const h2 = Math.atan2(agent2Obs[1] - 0.5, agent2Obs[0] - 0.5);
      const flyProbs2 = this.syncytium.step(agent2Obs, h2 - this.agent2.lastHeading, 0.5, env.agent2Energy, {
        dx: -dx12, dy: -dy12, dist: peerDist, sunAngle, stepDx: stepDx2, stepDy: stepDy2
      }, EGO_AGENT2);
      this.agent2.lastHeading = h2;
      this.agent2.lastFlyProbabilities = flyProbs2;

      // Giant fiber check for Agent 2
      this.agent2.isGFEscape = Boolean(agent2Obs[3] > 0.65 || (agent2Obs[3] > 0.35 && this.syncytium.brains[2].loomingVelocity > 0.25));
      if (this.agent2.isGFEscape) {
        this.giantFiberEvents++;
        this.agent2.commitmentTimer = 0;
      }

      const dynamicBeta2 = clamp(this.graftInfluence + 0.15, 0.1, 0.95);
      const combProbs2 = [0, 0, 0, 0];
      for (let a = 0; a < 4; a++) {
        combProbs2[a] = (1 - dynamicBeta2) * agent2Logits[a] + dynamicBeta2 * flyProbs2[a];
      }
      const finalProbs2 = softmax(combProbs2, 0.8);
      let maxA2 = 0;
      for (let a = 1; a < 4; a++) if (finalProbs2[a] > finalProbs2[maxA2]) maxA2 = a;

      if (this.agent2.isGFEscape) {
        this.agent2.committedAction = maxA2;
        this.agent2.commitmentTimer = 0;
      } else if (this.agent2.commitmentTimer > 0 && this.agent2.behavioralRegime !== "EVADE") {
        this.agent2.commitmentTimer--;
        maxA2 = this.agent2.committedAction;
      } else {
        this.agent2.committedAction = maxA2;
        this.agent2.commitmentTimer = 2;
      }

      // 5. Resolve Agent 3 (Cartographer-Scout)
      let maxA3 = 0, finalProbs3 = [0.25, 0.25, 0.25, 0.25];
      if (hasAgent3) {
        this._updateAgentRegime(this.agent3, agent3Obs);
        const h3 = Math.atan2(agent3Obs[1] - 0.5, agent3Obs[0] - 0.5);
        const flyProbs3 = this.syncytium.step(agent3Obs, h3 - this.agent3.lastHeading, 0.3, env.agent3Energy || 100, {
          dx: dx31, dy: dy31, dist: dist31, sunAngle, stepDx: stepDx3, stepDy: stepDy3
        }, EGO_AGENT3);
        this.agent3.lastHeading = h3;
        this.agent3.lastFlyProbabilities = flyProbs3;

        this.agent3.isGFEscape = Boolean(agent3Obs[3] > 0.65 || (agent3Obs[3] > 0.35 && this.syncytium.brains[2].loomingVelocity > 0.25));
        if (this.agent3.isGFEscape) {
          this.giantFiberEvents++;
          this.agent3.commitmentTimer = 0;
        }

        const dynamicBeta3 = clamp(this.graftInfluence + 0.1, 0.1, 0.95);
        const combProbs3 = [0, 0, 0, 0];
        for (let a = 0; a < 4; a++) {
          combProbs3[a] = (1 - dynamicBeta3) * agent3Logits[a] + dynamicBeta3 * flyProbs3[a];
        }
        finalProbs3 = softmax(combProbs3, 0.8);
        for (let a = 1; a < 4; a++) if (finalProbs3[a] > finalProbs3[maxA3]) maxA3 = a;

        if (this.agent3.isGFEscape) {
          this.agent3.committedAction = maxA3;
          this.agent3.commitmentTimer = 0;
        } else if (this.agent3.commitmentTimer > 0 && this.agent3.behavioralRegime !== "EVADE") {
          this.agent3.commitmentTimer--;
          maxA3 = this.agent3.committedAction;
        } else {
          this.agent3.committedAction = maxA3;
          this.agent3.commitmentTimer = 2;
        }

        // Cartographer Beacon Planting near diamond clusters
        if (this.agent3.behavioralRegime === "MAP_BEACON") {
          const alreadyHasNearby = this.beaconWaypoints.some(b => Math.hypot(b.x - env.agent3X, b.y - env.agent3Y) < 3.0);
          if (!alreadyHasNearby) {
            this.beaconWaypoints.push({
              x: env.agent3X,
              y: env.agent3Y,
              strength: 1.0,
              step: this.syncytium.syncytiumSteps
            });
            if (this.beaconWaypoints.length > 8) this.beaconWaypoints.shift();
          }
        }
      }

      // 6. AMMC Acoustic Courtship/Wing-Song Handshake & Energy Resonance (Dual Pair)
      let isAcousticHandshake = false;
      if (peerDist <= 2.5 && !this.agent1.isStasisHazard && !this.agent2.isStasisHazard) {
        isAcousticHandshake = true;
        this.handshakeEvents++;
        if (env.agent1Energy !== undefined) env.agent1Energy = Math.min(180, env.agent1Energy + 2);
        if (env.agent2Energy !== undefined) env.agent2Energy = Math.min(180, env.agent2Energy + 2);
        this.syncytium.applyReinforcement(0.4, 0.0, null, EGO_AGENT1);
        this.syncytium.applyReinforcement(0.4, 0.0, null, EGO_AGENT2);
      }

      // 7. Tri-Trophic Swarm Resonance (Triangular 3-Agent Mesh)
      let isTriSwarmResonance = false;
      if (hasAgent3 && dist12 <= 4.0 && dist23 <= 4.0 && dist31 <= 4.0) {
        isTriSwarmResonance = true;
        this.triSwarmResonanceEvents++;
        if (env.agent1Energy !== undefined) env.agent1Energy = Math.min(180, env.agent1Energy + 3);
        if (env.agent2Energy !== undefined) env.agent2Energy = Math.min(180, env.agent2Energy + 3);
        if (env.agent3Energy !== undefined) env.agent3Energy = Math.min(180, env.agent3Energy + 3);
        this.syncytium.applyReinforcement(0.8, 0.0, null, EGO_AGENT1);
        this.syncytium.applyReinforcement(0.8, 0.0, null, EGO_AGENT2);
        this.syncytium.applyReinforcement(0.8, 0.0, null, EGO_AGENT3);
      }

      this.syncytium.endTick();

      return {
        agent1: {
          action: this.actionNames[maxA1],
          actionIndex: maxA1,
          probabilities: finalProbs1,
          regime: this.agent1.behavioralRegime,
          isStasis: this.agent1.isStasisHazard,
          isGFEscape: this.agent1.isGFEscape || false
        },
        agent2: {
          action: this.actionNames[maxA2],
          actionIndex: maxA2,
          probabilities: finalProbs2,
          regime: this.agent2.behavioralRegime,
          isStasis: this.agent2.isStasisHazard,
          isGFEscape: this.agent2.isGFEscape || false
        },
        agent3: hasAgent3 ? {
          action: this.actionNames[maxA3],
          actionIndex: maxA3,
          probabilities: finalProbs3,
          regime: this.agent3.behavioralRegime,
          isStasis: this.agent3.isStasisHazard,
          isGFEscape: this.agent3.isGFEscape || false
        } : null,
        peerDist,
        dist12,
        dist23,
        dist31,
        sunAngle: this.sunAngle,
        isAcousticHandshake,
        handshakeEvents: this.handshakeEvents,
        isTriSwarmResonance,
        triSwarmResonanceEvents: this.triSwarmResonanceEvents,
        beaconWaypoints: this.beaconWaypoints
      };
    }

    // Single-agent backward compatibility wrapper
    resolveAction(agentState, agentActionLogits, novelty = 0, agentEnergy = 100) {
      this._updateAgentRegime(this.agent1, agentState);
      const h1 = Math.atan2(agentState[1] - 0.5, agentState[0] - 0.5);
      const flyProbs = this.syncytium.step(
        agentState, h1 - this.agent1.lastHeading, novelty, agentEnergy, null, EGO_AGENT1
      );
      this.agent1.lastHeading = h1;
      this.agent1.lastFlyProbabilities = flyProbs;

      const dynamicBeta = clamp(this.graftInfluence + (this.agent1.behavioralRegime === "EVADE" ? 0.25 : 0.1), 0.1, 0.95);
      const comb = [0, 0, 0, 0];
      for (let a = 0; a < 4; a++) {
        comb[a] = (1 - dynamicBeta) * agentActionLogits[a] + dynamicBeta * flyProbs[a];
      }
      const finalProbs = softmax(comb, 0.8);
      let maxIdx = 0;
      for (let a = 1; a < 4; a++) if (finalProbs[a] > finalProbs[maxIdx]) maxIdx = a;

      return {
        action: this.actionNames[maxIdx],
        actionIndex: maxIdx,
        probabilities: finalProbs,
        flyProbabilities: flyProbs,
        regime: this.agent1.behavioralRegime,
        gatingWeight: dynamicBeta
      };
    }

    /**
     * @param {number} reward
     * @param {boolean} hitHazard
     * @param {object|null} currentCoordinates
     * @param {string} [agentKey] - "agent1" | "agent2" | "agent3". Names the fly
     *   whose activations earned the outcome so credit lands on the synapses
     *   that actually drove the action. Defaults to the harvester.
     */
    feedback(reward, hitHazard, currentCoordinates = null, agentKey = EGO_AGENT1) {
      const rewardDelta = Math.max(0, reward);
      const hazardDelta = hitHazard ? 1.0 : (reward < 0 ? Math.abs(reward) : 0);
      this.syncytium.applyReinforcement(rewardDelta, hazardDelta, currentCoordinates, agentKey);
    }
  }

  // DiamondAgentGraft alias pointing to MultiAgentGraphGraft
  const DiamondAgentGraft = MultiAgentGraphGraft;

  // -------------------------------------------------------------
  // Resumable State Serialization & Persistence Engine
  // -------------------------------------------------------------
  class FlyBrainStateSerializer {
    static STORAGE_KEY = "diamond_sim_fly_brain_state_v7";

    /** Per-fly registers, as plain arrays, for the JSON document. */
    static _egoBankToJson(sync) {
      const bank = {};
      for (const [egoId, record] of sync.egoStates.entries()) {
        bank[egoId] = record.map(ego => ({
          scalars: Object.assign({}, ego.scalars),
          arrays: Object.fromEntries(Object.entries(ego.arrays).map(([k, v]) => [k, Array.from(v)])),
          born: Array.from(ego.born || [])
        }));
      }
      return bank;
    }

    static _egoBankFromJson(sync, bank) {
      if (!bank || typeof bank !== "object") return;
      sync.egoStates.clear();
      for (const egoId of Object.keys(bank)) {
        const saved = bank[egoId];
        if (!Array.isArray(saved)) continue;
        const record = sync._egoRecord(egoId);
        for (let i = 0; i < Math.min(record.length, saved.length); i++) {
          const src = saved[i];
          if (!src) continue;
          if (src.scalars) Object.assign(record[i].scalars, src.scalars);
          if (src.arrays) {
            for (const key of Object.keys(src.arrays)) {
              record[i].arrays[key] = Float32Array.from(src.arrays[key]);
            }
          }
          if (Array.isArray(src.born)) record[i].born = Float32Array.from(src.born);
        }
      }
    }

    static serialize(graft, extraAgentData = {}) {
      const sync = graft.syncytium;
      const stateObj = {
        version: "7.0.0",
        config: Object.assign({}, sync.config),
        tickCount: sync.tickCount || 0,
        lastActionIndex: sync.lastActionIndex,
        egoStates: FlyBrainStateSerializer._egoBankToJson(sync),
        timestamp: Date.now(),
        worldSeed: sync.worldSeed,
        prngDrawCount: sync.prng ? sync.prng.drawCount : 0,
        prngState: sync.prng ? sync.prng.getState() : null,
        neurogenesisPrngState: sync.neurogenesis.prng ? sync.neurogenesis.prng.getState() : null,
        neurogenesisBirthCounter: sync.neurogenesis.birthCounter || 0,
        graftInfluence: graft.graftInfluence,
        isPretrained: sync.isPretrained,
        pretrainingEpochs: sync.pretrainingEpochs,
        syncytiumSteps: sync.syncytiumSteps,
        circadianClock: sync.circadianClock || 0,
        sunAngle: graft.sunAngle || 0,
        mitosisEvents: sync.neurogenesis.mitosisCount,
        apoptosisEvents: sync.neurogenesis.apoptosisCount,
        stasisEvents: graft.stasisEvents || 0,
        handshakeEvents: graft.handshakeEvents || 0,
        triSwarmResonanceEvents: graft.triSwarmResonanceEvents || 0,
        giantFiberEvents: graft.giantFiberEvents || 0,
        beaconWaypoints: graft.beaconWaypoints || [],
        commissuralWeights: Array.from(sync.commissuralWeights),
        engramBank: sync.engramBank,
        lastRPE: sync.lastRPE,
        agents: {
          agent1: { regime: graft.agent1.behavioralRegime, dwell: graft.agent1.dwellTicks },
          agent2: { regime: graft.agent2.behavioralRegime, dwell: graft.agent2.dwellTicks },
          agent3: graft.agent3 ? { regime: graft.agent3.behavioralRegime, dwell: graft.agent3.dwellTicks } : null
        },
        extraAgentData,
        brains: sync.brains.map(b => ({
          id: b.id,
          role: b.role,
          compassHeading: b.compassHeading,
          dopaminePAM: b.dopaminePAM,
          dopaminePPL1: b.dopaminePPL1,
          octopamineOA: b.octopamineOA,
          serotonin5HT: b.serotonin5HT,
          metabolicSatiety: b.metabolicSatiety,
          neuropeptideNPF: b.neuropeptideNPF || 0,
          neuropeptideSIFamide: b.neuropeptideSIFamide || 0,
          lalFlipFlop: b.lalFlipFlop,
          vncTorque: b.vncTorque,
          ammcVibration: b.ammcVibration,
          pbPhaseShift: b.pbPhaseShift || 0,
          ebStabilization: b.ebStabilization || 0,
          noOdometryDistance: b.noOdometryDistance || 0,
          noHomeVector: b.noHomeVector ? Array.from(b.noHomeVector) : [0, 0],
          aotuSunHeading: b.aotuSunHeading || 0,
          aotuEVectorAlignment: b.aotuEVectorAlignment || 0,
          smpLatchedAction: b.smpLatchedAction || -1,
          alProjection: Array.from(b.alProjection),
          kcActivations: Array.from(b.kcActivations),
          mbonActivations: Array.from(b.mbonActivations),
          compassRing: Array.from(b.compassRing),
          kcToMbonWeights: Array.from(b.kcToMbonWeights),
          eligibilityTraces: Array.from(b.eligibilityTraces),
          opticMotionFlow: Array.from(b.opticMotionFlow),
          epgRing: Array.from(b.epgRing),
          ringAmplitude: b.ringAmplitude,
          ringCertainty: b.ringCertainty,
          aplActivity: b.aplActivity,
          kcSparsity: b.kcSparsity,
          lastActionIndex: b.lastActionIndex,
          bornNeurons: b.bornNeurons.map(n => ({
            id: n.id,
            age: n.age,
            maturity: n.maturity,
            activation: n.activation,
            weights: Array.from(n.weights),
            mbonWeights: Array.from(n.mbonWeights)
          }))
        }))
      };

      return JSON.stringify(stateObj);
    }

    static deserialize(graft, stateData) {
      const data = typeof stateData === "string" ? JSON.parse(stateData) : stateData;
      if (!data || !data.brains || data.brains.length < 5) {
        throw new Error("Invalid or incompatible fly brain state data");
      }

      graft.graftInfluence = data.graftInfluence !== undefined ? data.graftInfluence : 0.55;
      graft.stasisEvents = data.stasisEvents || 0;
      if (data.sunAngle !== undefined) graft.sunAngle = data.sunAngle;
      if (data.triSwarmResonanceEvents !== undefined) graft.triSwarmResonanceEvents = data.triSwarmResonanceEvents;
      if (data.giantFiberEvents !== undefined) graft.giantFiberEvents = data.giantFiberEvents;
      if (Array.isArray(data.beaconWaypoints)) graft.beaconWaypoints = data.beaconWaypoints;

      if (data.agents) {
        if (data.agents.agent1) {
          graft.agent1.behavioralRegime = data.agents.agent1.regime || "FORAGE";
          graft.agent1.dwellTicks = data.agents.agent1.dwell || 0;
        }
        if (data.agents.agent2) {
          graft.agent2.behavioralRegime = data.agents.agent2.regime || "PIONEER";
          graft.agent2.dwellTicks = data.agents.agent2.dwell || 0;
        }
        if (data.agents.agent3 && graft.agent3) {
          graft.agent3.behavioralRegime = data.agents.agent3.regime || "SCOUT";
          graft.agent3.dwellTicks = data.agents.agent3.dwell || 0;
        }
      }

      const sync = graft.syncytium;
      sync.worldSeed = data.worldSeed !== undefined ? data.worldSeed : 42;
      sync.prng = new MulberryPRNG(sync.worldSeed);
      if (data.prngState) {
        // v7+: exact stream position. Older files carry only a draw count,
        // which cannot place the stream, so they resume from the seed.
        sync.prng.setState(data.prngState);
      } else if (data.prngDrawCount) {
        sync.prng.drawCount = data.prngDrawCount;
      }
      if (data.neurogenesisPrngState) {
        sync.neurogenesis.prng.setState(data.neurogenesisPrngState);
      } else {
        sync.neurogenesis.prng = sync.prng.fork(1);
      }
      sync.neurogenesis.birthCounter = data.neurogenesisBirthCounter || 0;

      sync.syncytiumSteps = data.syncytiumSteps || 0;
      sync.tickCount = data.tickCount !== undefined ? data.tickCount : (data.syncytiumSteps || 0);
      if (data.lastActionIndex !== undefined) sync.lastActionIndex = data.lastActionIndex;
      if (data.config) {
        // Mechanism selection is part of the run: a file saved from the legacy
        // circuit must resume on the legacy circuit.
        sync.config = resolveConfig(data.config);
        for (const brain of sync.brains) brain.config = sync.config;
      }
      if (data.circadianClock !== undefined) sync.circadianClock = data.circadianClock;
      if (data.handshakeEvents !== undefined) graft.handshakeEvents = data.handshakeEvents;
      sync.isPretrained = data.isPretrained || false;
      sync.pretrainingEpochs = data.pretrainingEpochs || 0;
      sync.neurogenesis.mitosisCount = data.mitosisEvents || 0;
      sync.neurogenesis.apoptosisCount = data.apoptosisEvents || 0;
      sync.lastRPE = data.lastRPE || 0;

      if (data.commissuralWeights && data.commissuralWeights.length === sync.commissuralWeights.length) {
        sync.commissuralWeights.set(data.commissuralWeights);
      }
      sync.engramBank = Array.isArray(data.engramBank) ? data.engramBank : [];

      const restoreCount = Math.min(sync.brains.length, data.brains.length);
      for (let i = 0; i < restoreCount; i++) {
        const bData = data.brains[i];
        const brain = sync.brains[i];
        brain.role = bData.role || brain.role;
        brain.compassHeading = bData.compassHeading || 0;
        brain.dopaminePAM = bData.dopaminePAM || 0;
        brain.dopaminePPL1 = bData.dopaminePPL1 || 0;
        brain.octopamineOA = bData.octopamineOA !== undefined ? bData.octopamineOA : 0.2;
        brain.serotonin5HT = bData.serotonin5HT !== undefined ? bData.serotonin5HT : 0.5;
        brain.metabolicSatiety = bData.metabolicSatiety !== undefined ? bData.metabolicSatiety : 1.0;
        if (bData.neuropeptideNPF !== undefined) brain.neuropeptideNPF = bData.neuropeptideNPF;
        if (bData.neuropeptideSIFamide !== undefined) brain.neuropeptideSIFamide = bData.neuropeptideSIFamide;
        brain.lalFlipFlop = bData.lalFlipFlop || 0;
        brain.vncTorque = bData.vncTorque !== undefined ? bData.vncTorque : 1.0;
        brain.ammcVibration = bData.ammcVibration || 0;
        if (bData.pbPhaseShift !== undefined) brain.pbPhaseShift = bData.pbPhaseShift;
        if (bData.ebStabilization !== undefined) brain.ebStabilization = bData.ebStabilization;
        if (bData.noOdometryDistance !== undefined) brain.noOdometryDistance = bData.noOdometryDistance;
        if (bData.noHomeVector) brain.noHomeVector = [bData.noHomeVector[0] || 0, bData.noHomeVector[1] || 0];
        if (bData.aotuSunHeading !== undefined) brain.aotuSunHeading = bData.aotuSunHeading;
        if (bData.aotuEVectorAlignment !== undefined) brain.aotuEVectorAlignment = bData.aotuEVectorAlignment;
        if (bData.smpLatchedAction !== undefined) brain.smpLatchedAction = bData.smpLatchedAction;

        if (bData.alProjection) brain.alProjection.set(bData.alProjection);
        if (bData.kcActivations) brain.kcActivations.set(bData.kcActivations);
        if (bData.mbonActivations) brain.mbonActivations.set(bData.mbonActivations);
        if (bData.compassRing) brain.compassRing.set(bData.compassRing);
        if (bData.kcToMbonWeights) brain.kcToMbonWeights.set(bData.kcToMbonWeights);
        if (bData.eligibilityTraces) brain.eligibilityTraces.set(bData.eligibilityTraces);
        if (bData.opticMotionFlow && brain.opticMotionFlow) brain.opticMotionFlow.set(bData.opticMotionFlow);
        if (bData.epgRing && brain.epgRing && brain.epgRing.length === bData.epgRing.length) {
          brain.epgRing.set(bData.epgRing);
        }
        if (bData.ringAmplitude !== undefined) brain.ringAmplitude = bData.ringAmplitude;
        if (bData.ringCertainty !== undefined) brain.ringCertainty = bData.ringCertainty;
        if (bData.aplActivity !== undefined) brain.aplActivity = bData.aplActivity;
        if (bData.kcSparsity !== undefined) brain.kcSparsity = bData.kcSparsity;
        if (bData.lastActionIndex !== undefined) brain.lastActionIndex = bData.lastActionIndex;

        brain.bornNeurons = (bData.bornNeurons || []).map(n => ({
          id: n.id,
          age: n.age,
          maturity: n.maturity,
          activation: n.activation,
          weights: new Float32Array(n.weights),
          mbonWeights: new Float32Array(n.mbonWeights)
        }));
      }

      FlyBrainStateSerializer._egoBankFromJson(sync, data.egoStates);

      return data.extraAgentData || {};
    }

    static saveToLocalStorage(graft, extraAgentData = {}) {
      try {
        if (typeof localStorage === "undefined") return false;
        const json = this.serialize(graft, extraAgentData);
        localStorage.setItem(this.STORAGE_KEY, json);
        return true;
      } catch (err) {
        console.warn("Could not save fly brain state to localStorage:", err);
        return false;
      }
    }

    static loadFromLocalStorage(graft) {
      try {
        if (typeof localStorage === "undefined") return null;
        let json = localStorage.getItem(this.STORAGE_KEY);
        if (!json) {
          // Fallback check for v5 state
          json = localStorage.getItem("diamond_sim_fly_brain_state_v5");
        }
        if (!json) {
          // Fallback check for v4 state
          json = localStorage.getItem("diamond_sim_fly_brain_state_v4");
        }
        if (!json) return null;
        return this.deserialize(graft, json);
      } catch (err) {
        console.warn("Could not load fly brain state from localStorage:", err);
        return null;
      }
    }

    static exportToFile(graft, extraAgentData = {}, filename = "fly_diamond_state.json") {
      const json = this.serialize(graft, extraAgentData);
      if (typeof document !== "undefined") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      return json;
    }
  }

  // -------------------------------------------------------------
  // Public Exports
  // -------------------------------------------------------------
  return {
    DEFAULT_CONFIG,
    LEGACY_CONFIG,
    resolveConfig,
    angleDelta,
    wrapAngle,
    MulberryPRNG,
    ChemicalFieldGrid,
    DrosophilaBrain,
    NeurogenesisEngine,
    PreTrainingEngine,
    SixteenFlyBrainSyncytium,
    ElevenFlyBrainSyncytium,
    EightFlyBrainSyncytium,
    SevenFlyBrainSyncytium,
    FiveFlyBrainSyncytium,
    MultiAgentGraphGraft,
    DiamondAgentGraft,
    FlyBrainStateSerializer
  };
});
