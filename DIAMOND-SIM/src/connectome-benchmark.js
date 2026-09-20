/**
 * @file connectome-benchmark.js
 * Automated Headless & Client-Side Benchmark Suite for Drosophila Connectomes.
 * Compares 4 Agent Paradigms across reproducibility seeds:
 *   1. RandomWalkPolicy: Baseline Brownian exploration
 *   2. SingleBrainPolicy: Isolated Brain 0 (Antennal Lobe chemotaxis)
 *   3. CentralComplex8Policy: 8-Brain Central Complex subsystem
 *   4. SixteenBrainSyncytiumPolicy: Full 16-Brain Syncytium with Odometry, Sun Compass, PB steering & SMP Latch
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./fly-brain-engine.js"));
  } else {
    root.ConnectomeBenchmark = factory(root.FlyBrainEngine);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (FlyBrainEngine) {
  "use strict";

  const {
    MulberryPRNG,
    ChemicalFieldGrid,
    DrosophilaBrain,
    SixteenFlyBrainSyncytium,
    PreTrainingEngine
  } = FlyBrainEngine;

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // -------------------------------------------------------------
  // Benchmark Arena (Headless Environment with Chemical Diffusion)
  // -------------------------------------------------------------
  class BenchmarkArena {
    constructor(gridSize = 16, seed = 42, diamondCount = 8, hazardCount = 4) {
      this.gridSize = gridSize;
      this.seed = seed;
      this.diamondCount = diamondCount;
      this.hazardCount = hazardCount;
      this.prng = new MulberryPRNG(seed);

      this.agentX = 0;
      this.agentY = 0;
      this.agentEnergy = 100;
      this.maxEnergy = 160;

      this.diamonds = [];
      this.hazards = [];
      this.visitedCells = new Set();
      this.chemGrid = new ChemicalFieldGrid(gridSize, gridSize);

      this.diamondsCollected = 0;
      this.hazardsHit = 0;
      this.stasisEvents = 0;
      this.steps = 0;
      this.dwellTicks = 0;

      this._init();
    }

    _key(x, y) {
      return `${x},${y}`;
    }

    _init() {
      const occupied = new Set();
      this.agentX = this.prng.int(this.gridSize);
      this.agentY = this.prng.int(this.gridSize);
      occupied.add(this._key(this.agentX, this.agentY));
      this.visitedCells.add(this._key(this.agentX, this.agentY));

      while (this.diamonds.length < this.diamondCount) {
        const x = this.prng.int(this.gridSize);
        const y = this.prng.int(this.gridSize);
        const k = this._key(x, y);
        if (!occupied.has(k)) {
          this.diamonds.push({ x, y });
          occupied.add(k);
        }
      }

      while (this.hazards.length < this.hazardCount) {
        const x = this.prng.int(this.gridSize);
        const y = this.prng.int(this.gridSize);
        const k = this._key(x, y);
        if (!occupied.has(k)) {
          this.hazards.push({ x, y });
          occupied.add(k);
        }
      }

      // Initial chemical seeding
      this._diffusePlumes();
    }

    _diffusePlumes() {
      for (const d of this.diamonds) this.chemGrid.emit("foodOdor", d.x, d.y, 0.45);
      for (const h of this.hazards) this.chemGrid.emit("threatOdor", h.x, h.y, 0.45);
      this.chemGrid.step(0.18, 0.94);
    }

    getSensoryObs(heading = 0) {
      const dnX = this.agentX / this.gridSize;
      const dnY = this.agentY / this.gridSize;
      const normE = this.agentEnergy / 100;

      let nearestDiamond = 999;
      let diamondAngle = 0;
      for (const d of this.diamonds) {
        const dist = Math.hypot(d.x - this.agentX, d.y - this.agentY);
        if (dist < nearestDiamond) {
          nearestDiamond = dist;
          diamondAngle = Math.atan2(d.y - this.agentY, d.x - this.agentX);
        }
      }

      let nearestHazard = 999;
      let hazardAngle = 0;
      for (const h of this.hazards) {
        const dist = Math.hypot(h.x - this.agentX, h.y - this.agentY);
        if (dist < nearestHazard) {
          nearestHazard = dist;
          hazardAngle = Math.atan2(h.y - this.agentY, h.x - this.agentX);
        }
      }

      const diamondReward = nearestDiamond < 6 ? (6 - nearestDiamond) / 6 : 0;
      const hazardThreat = nearestHazard < 4 ? (4 - nearestHazard) / 4 : 0;

      // Bilateral antennal odor sampling
      const biFood = this.chemGrid.sampleBilateral("foodOdor", this.agentX, this.agentY, heading, 0.8);
      const leftAntenna = clamp(biFood.left, 0, 1);
      const rightAntenna = clamp(biFood.right, 0, 1);

      return [
        dnX, dnY,
        diamondReward,
        hazardThreat,
        normE,
        Math.min(nearestDiamond / this.gridSize, 1),
        Math.sin(diamondAngle), Math.cos(diamondAngle),
        Math.sin(hazardAngle), Math.cos(hazardAngle),
        0, 0,
        leftAntenna,
        rightAntenna
      ];
    }

    step(actionIndex) {
      this.steps++;
      const lastX = this.agentX;
      const lastY = this.agentY;

      // 0=up, 1=down, 2=left, 3=right
      const dx = [0, 0, -1, 1][actionIndex] || 0;
      const dy = [-1, 1, 0, 0][actionIndex] || 0;

      const targetX = clamp(this.agentX + dx, 0, this.gridSize - 1);
      const targetY = clamp(this.agentY + dy, 0, this.gridSize - 1);

      this.agentX = targetX;
      this.agentY = targetY;
      this.visitedCells.add(this._key(this.agentX, this.agentY));

      // Inactivity / Stasis check: 4 still ticks triggers stasis penalty
      if (this.agentX === lastX && this.agentY === lastY) {
        this.dwellTicks++;
        if (this.dwellTicks >= 4) {
          this.stasisEvents++;
          this.agentEnergy = Math.max(0, this.agentEnergy - 8);
        }
      } else {
        this.dwellTicks = 0;
      }

      // Base step energy consumption
      this.agentEnergy = Math.max(0, this.agentEnergy - 1);

      let collectedDiamond = false;
      let hitHazard = false;

      // Diamond collision
      for (let i = this.diamonds.length - 1; i >= 0; i--) {
        if (this.diamonds[i].x === this.agentX && this.diamonds[i].y === this.agentY) {
          this.diamonds.splice(i, 1);
          this.diamondsCollected++;
          this.agentEnergy = Math.min(this.maxEnergy, this.agentEnergy + 25);
          collectedDiamond = true;

          // Respawn diamond in empty location
          const occupied = new Set([
            this._key(this.agentX, this.agentY),
            ...this.hazards.map(h => this._key(h.x, h.y)),
            ...this.diamonds.map(d => this._key(d.x, d.y))
          ]);
          let rx, ry;
          let attempts = 0;
          do {
            rx = this.prng.int(this.gridSize);
            ry = this.prng.int(this.gridSize);
            attempts++;
          } while (occupied.has(this._key(rx, ry)) && attempts < 50);
          this.diamonds.push({ x: rx, y: ry });
          break;
        }
      }

      // Hazard collision
      for (const h of this.hazards) {
        if (h.x === this.agentX && h.y === this.agentY) {
          this.hazardsHit++;
          this.agentEnergy = Math.max(0, this.agentEnergy - 20);
          hitHazard = true;
          break;
        }
      }

      this._diffusePlumes();

      const done = this.agentEnergy <= 0;
      return {
        done,
        agentX: this.agentX,
        agentY: this.agentY,
        agentEnergy: this.agentEnergy,
        diamondsCollected: this.diamondsCollected,
        hazardsHit: this.hazardsHit,
        stasisEvents: this.stasisEvents,
        stepDx: this.agentX - lastX,
        stepDy: this.agentY - lastY,
        collectedDiamond,
        hitHazard
      };
    }
  }

  // -------------------------------------------------------------
  // Policy Definitions
  // -------------------------------------------------------------

  class RandomWalkPolicy {
    constructor(seed = 42) {
      this.name = "RandomWalk";
      this.prng = new MulberryPRNG(seed);
    }
    act(obs, stepDx, stepDy, energy, stepIndex, currentX = 0, currentY = 0, gridSize = 16) {
      const legalActions = [];
      const dxs = [0, 0, -1, 1], dys = [-1, 1, 0, 0];
      for (let a = 0; a < 4; a++) {
        const nx = currentX + dxs[a], ny = currentY + dys[a];
        if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
          legalActions.push(a);
        }
      }
      return legalActions[this.prng.int(legalActions.length)] || 0;
    }
    reinforce() {}
  }

  class SingleBrainPolicy {
    constructor() {
      this.name = "SingleBrain_AL";
      this.brain = new DrosophilaBrain(0, "forager");
      this.heading = 0;
    }
    act(sensoryObs, stepDx, stepDy, energy, stepIndex, currentX = 0, currentY = 0, gridSize = 16) {
      const outputs = this.brain.forward(sensoryObs, 0, null, null);
      const sorted = [0, 1, 2, 3].sort((a, b) => outputs[b] - outputs[a]);
      const dxs = [0, 0, -1, 1], dys = [-1, 1, 0, 0];
      for (const a of sorted) {
        const nx = currentX + dxs[a], ny = currentY + dys[a];
        if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) return a;
      }
      return sorted[0];
    }
    reinforce(rew, haz) {
      this.brain.applyPlasticity(rew > 0 ? 1.0 : 0, haz > 0 ? 1.0 : 0);
    }
  }

  class CentralComplex8Policy {
    constructor(seed = 42) {
      this.name = "CentralComplex_8B";
      this.syncytium = new SixteenFlyBrainSyncytium(seed);
      this.syncytium.brainCount = 8;
      this.heading = 0;
    }
    act(sensoryObs, stepDx = 0, stepDy = 0, energy = 100, stepIndex = 0, currentX = 0, currentY = 0, gridSize = 16) {
      const hDelta = Math.atan2(stepDy, stepDx || 0.001);
      const probs = this.syncytium.step(sensoryObs, hDelta, 0, energy, {
        dx: 0, dy: 0, dist: 5, sunAngle: 0, stepDx, stepDy
      });
      const sorted = [0, 1, 2, 3].sort((a, b) => probs[b] - probs[a]);
      const dxs = [0, 0, -1, 1], dys = [-1, 1, 0, 0];
      for (const a of sorted) {
        const nx = currentX + dxs[a], ny = currentY + dys[a];
        if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) return a;
      }
      return sorted[0];
    }
    reinforce(rew, haz, coords) {
      this.syncytium.applyReinforcement(rew, haz, coords);
    }
  }

  class SixteenBrainSyncytiumPolicy {
    constructor(seed = 42) {
      this.name = "Syncytium_16B";
      this.syncytium = new SixteenFlyBrainSyncytium(seed);
      PreTrainingEngine.runPreTraining(this.syncytium, 15);
      this.heading = 0;
      this.latchAction = -1;
      this.latchTimer = 0;
    }
    act(sensoryObs, stepDx = 0, stepDy = 0, energy = 100, stepIndex = 0, currentX = 0, currentY = 0, gridSize = 16) {
      const sunAngle = ((stepIndex % 120) / 120) * Math.PI * 2;
      const hDelta = Math.atan2(stepDy, stepDx || 0.001);

      const probs = this.syncytium.step(sensoryObs, hDelta, 0, energy, {
        dx: 0, dy: 0, dist: 99, sunAngle, stepDx, stepDy
      });

      const dxs = [0, 0, -1, 1], dys = [-1, 1, 0, 0];
      const sorted = [0, 1, 2, 3].sort((a, b) => probs[b] - probs[a]);

      // Break latch if near diamond or threat
      if ((sensoryObs[2] || 0) > 0.05 || (sensoryObs[3] || 0) > 0.25) {
        this.latchTimer = 0;
      }

      // SMP Action commitment latching
      if (this.latchTimer > 0 && this.latchAction >= 0) {
        const lx = currentX + dxs[this.latchAction];
        const ly = currentY + dys[this.latchAction];
        if (lx >= 0 && lx < gridSize && ly >= 0 && ly < gridSize) {
          this.latchTimer--;
          return this.latchAction;
        } else {
          this.latchTimer = 0;
        }
      }

      let chosen = sorted[0];
      for (const a of sorted) {
        const nx = currentX + dxs[a];
        const ny = currentY + dys[a];
        if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
          chosen = a;
          break;
        }
      }

      this.latchAction = chosen;
      this.latchTimer = 2;
      return chosen;
    }
    reinforce(rew, haz, coords) {
      this.syncytium.applyReinforcement(rew, haz, coords);
    }
  }

  // -------------------------------------------------------------
  // Connectome Benchmark Runner
  // -------------------------------------------------------------
  class ConnectomeBenchmarkRunner {
    constructor() {
      this.supportedArms = [
        "RandomWalk",
        "SingleBrain_AL",
        "CentralComplex_8B",
        "Syncytium_16B"
      ];
    }

    _createPolicy(armName, seed) {
      switch (armName) {
        case "RandomWalk":
          return new RandomWalkPolicy(seed);
        case "SingleBrain_AL":
          return new SingleBrainPolicy();
        case "CentralComplex_8B":
          return new CentralComplex8Policy(seed);
        case "Syncytium_16B":
          return new SixteenBrainSyncytiumPolicy(seed);
        default:
          throw new Error(`Unsupported benchmark arm: ${armName}`);
      }
    }

    runEpisode(armName, seed = 42, stepLimit = 100) {
      const arena = new BenchmarkArena(16, seed, 8, 4);
      const policy = this._createPolicy(armName, seed);

      let lastDx = 0, lastDy = 0;
      let heading = 0;

      for (let t = 0; t < stepLimit; t++) {
        const obs = arena.getSensoryObs(heading);
        const action = policy.act(
          obs, lastDx, lastDy, arena.agentEnergy, t, arena.agentX, arena.agentY, arena.gridSize
        );

        const res = arena.step(action);
        lastDx = res.stepDx;
        lastDy = res.stepDy;
        heading = Math.atan2(lastDy, lastDx || 0.0001);

        if (res.collectedDiamond) {
          policy.reinforce(1.0, 0, { x: arena.agentX, y: arena.agentY });
        }
        if (res.hitHazard) {
          policy.reinforce(0, 1.0, { x: arena.agentX, y: arena.agentY });
        }

        if (res.done) break;
      }

      // Net score calculation
      const netScore =
        arena.diamondsCollected * 25 -
        arena.hazardsHit * 20 -
        arena.stasisEvents * 8 +
        Math.floor(arena.agentEnergy * 0.2);

      return {
        arm: armName,
        seed,
        stepsSurvived: arena.steps,
        diamondsCollected: arena.diamondsCollected,
        hazardsHit: arena.hazardsHit,
        stasisEvents: arena.stasisEvents,
        finalEnergy: arena.agentEnergy,
        uniqueCells: arena.visitedCells.size,
        netScore
      };
    }

    async runComparativeBenchmark({
      episodesPerArm = 5,
      stepLimit = 100,
      seeds = null,
      onProgress = null
    } = {}) {
      const arms = this.supportedArms;
      const baseSeeds = seeds || Array.from({ length: episodesPerArm }, (_, i) => 1001 + i * 73);
      const rawResults = {};
      arms.forEach(arm => (rawResults[arm] = []));

      const totalRuns = arms.length * baseSeeds.length;
      let completed = 0;

      for (const arm of arms) {
        for (const seed of baseSeeds) {
          const ep = this.runEpisode(arm, seed, stepLimit);
          rawResults[arm].push(ep);
          completed++;
          if (onProgress) {
            onProgress({
              arm,
              seed,
              completed,
              totalRuns,
              percent: Math.round((completed / totalRuns) * 100)
            });
            if (typeof setTimeout !== "undefined") {
              await new Promise(r => setTimeout(r, 0));
            }
          }
        }
      }

      // Aggregate metrics per arm
      const aggregated = arms.map(arm => {
        const eps = rawResults[arm];
        const n = eps.length || 1;
        const meanDiamonds = eps.reduce((acc, e) => acc + e.diamondsCollected, 0) / n;
        const meanHazards = eps.reduce((acc, e) => acc + e.hazardsHit, 0) / n;
        const meanStasis = eps.reduce((acc, e) => acc + e.stasisEvents, 0) / n;
        const meanFinalEnergy = eps.reduce((acc, e) => acc + e.finalEnergy, 0) / n;
        const meanStepsSurvived = eps.reduce((acc, e) => acc + e.stepsSurvived, 0) / n;
        const meanUniqueCells = eps.reduce((acc, e) => acc + e.uniqueCells, 0) / n;
        const meanNetScore = eps.reduce((acc, e) => acc + e.netScore, 0) / n;

        return {
          arm,
          episodes: n,
          meanDiamonds: parseFloat(meanDiamonds.toFixed(2)),
          meanHazards: parseFloat(meanHazards.toFixed(2)),
          meanStasis: parseFloat(meanStasis.toFixed(2)),
          meanFinalEnergy: parseFloat(meanFinalEnergy.toFixed(2)),
          meanStepsSurvived: parseFloat(meanStepsSurvived.toFixed(2)),
          meanUniqueCells: parseFloat(meanUniqueCells.toFixed(2)),
          meanNetScore: parseFloat(meanNetScore.toFixed(2)),
          raw: eps
        };
      });

      // Compute win rate per seed
      const winCounts = {};
      arms.forEach(a => (winCounts[a] = 0));
      for (let i = 0; i < baseSeeds.length; i++) {
        let bestScore = -Infinity;
        let bestArm = arms[0];
        for (const arm of arms) {
          const score = rawResults[arm][i].netScore;
          if (score > bestScore) {
            bestScore = score;
            bestArm = arm;
          }
        }
        winCounts[bestArm]++;
      }

      aggregated.forEach(item => {
        item.winRate = parseFloat(((winCounts[item.arm] / baseSeeds.length) * 100).toFixed(1));
      });

      return {
        timestamp: Date.now(),
        episodesPerArm: baseSeeds.length,
        stepLimit,
        seeds: baseSeeds,
        arms: aggregated
      };
    }
  }

  return {
    BenchmarkArena,
    RandomWalkPolicy,
    SingleBrainPolicy,
    CentralComplex8Policy,
    SixteenBrainSyncytiumPolicy,
    ConnectomeBenchmarkRunner
  };
});
