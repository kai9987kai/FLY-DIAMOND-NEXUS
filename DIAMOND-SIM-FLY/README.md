# DIAMOND SIM

Three educational browser simulations for exploring learning agents. Open **[index.html](index.html)** to choose a lab.

- **[World Lab](worldlab.html)**: deterministic reward-map learning, four strategies, inspectable planning, exact snapshots, paired-seed comparisons and downloadable evidence. Works offline with no build step.
- **[Diamond Nexus](diamond-nexus.html)**: the existing larger simulation with neural experts, evolution, terrain, dynamic obstacles, curiosity and feature controls. Loads pinned TensorFlow.js and Chart.js from a public CDN.
- **[Fly Lab](fly-diamond-nexus.html)**: 22 brain modules driving three agents through changing weather, wind, resources and moving predators. Dense graph inspection, live matrix editing, expanded God Mode and a bounded Supermix graft. Works offline; Supermix connectivity requires the local server.

These are simplified research sandboxes. They do not reproduce DIAMOND, Dreamer, TD-MPC2 or state-of-the-art RL results, and the Fly Lab does not reproduce any published connectome model. See [research and limits](docs/research.md).

## Run

Double-click `index.html`, or use Node 20+:

```sh
npm run serve
```

Open http://127.0.0.1:8080. The server binds only to localhost. `PORT` changes the port. No installation is needed for the server, engine tests or benchmarks.

## World Lab

Use **Run**, **Step** and **Reset**. Seed and agent count apply on Reset; learning and strategy controls affect subsequent ticks. Curious and Planner adjust the current run's settings; Swarm also resets the population to eight agents. Model caution only affects beam planning. Search budget zero disables MPC and imagined Q updates. Speed is an upper limit on steps per rendered frame; expensive runs yield earlier.

Choose the agent above the model canvas and inspect reward beliefs, uncertainty, Q-values, visits or prediction error. The drawn plan is the actual scored trajectory. Ground-truth geometry and current hazards are known to agents; reward beliefs are learned locally. Agents can share sensed rewards.

Keyboard controls, while outside inputs and buttons: **Space** run/pause, **S** step, **R** reset, **F** fullscreen. A hidden tab pauses the live World Lab.

**Save Snapshot** exports a complete v3 run, including every random generator and ordered learning state. Loading validates the whole file before replacing the live world and resumes paused. Version 2 files omitted random state and cannot be replayed exactly; they are rejected with an explanation. Nexus checkpoints use their own separate format.

**Export CSV** contains the last 360 metric samples, matching the rolling chart. Snapshots retain cumulative agent totals, the current learned state and that rolling history; they are not full trajectory logs.

### Compare strategies

The comparison panel runs beam planning against the original shooting planner, greedy/Q or random actions. Use 2–30 distinct positive seeds and up to 2,000 ticks per run. The agent count comes from the active world; shared learning/world settings come from the current controls. Both arms start fresh and have equal step budgets. They do not modify the live world.

The table reports raw paired rewards and hazards; JSON/CSV reports also include complete settings, coverage, model error, energy, collisions and respawns. The paired bootstrap interval resamples seeds, not individual agents. Cancel retains complete pairs only. Equal step/search settings do not imply equal computation, and a positive result is specific to its configuration.

```sh
npm run benchmark -- --baseline legacy --output output/benchmark.json --csv output/benchmark.csv
npm run benchmark -- --seeds 1,2,3,4,5,6,7,8,9,10 --steps 300 --agents 2 --baseline greedy
npm run benchmark:original
```

The last command compares the entire current core against the unchanged World Lab at Git commit `3abf50785a178e1f78e216cc10dce66928ce0760`; it requires that history to exist locally. It fixes 20 seeds, 300 ticks and two agents, checks identical initial states, and writes `output/comparison-original.json`. [Recorded results and caveats](docs/validation.md) include source hashes and raw pairs.

## Fly Lab

Twenty-two specialised modules share learned synapses while each fly keeps its own heading, odometry, gait phase, metabolic state, memory and action latches. Three agents run in the same world: the Harvester forages, the Sentinel-Pioneer sweeps for hazards, and the Cartographer-Scout maps and plants beacons. The original 16-module network remains selectable.

Use **Start**, **Pause** and **Reset**; seed applies on Reset. **Pre-Train** conditions sensory representations offline. God Mode paints food, hazards, scent, walls, water, refuges and predators; brush radius and strength apply to supported tools. Erase removes terrain. Walls cannot cover a fly or its adjacent exits. Refuges protect against predators; water reduces heat costs. Weather presets and individual temperature, humidity, wind, rain, regrowth and threat controls affect the running world.

The six added modules are **Plume Tracker**, **Climate Homeostat**, **Threat Forecast**, **Route Memory**, **Uncertainty Monitor** and **Social Coordinator**. They use finite per-agent state and bounded heuristic signals. The 22×22×4 matrix has 1,936 slots, of which 1,848 are off-diagonal action connections across 462 directed pairs. These are synthetic connections, not imported MaleCNS synapses. Graph edge density, threshold and selection focus change the view; coupling strength and matrix editing change the actual policy.

The **Supermix graft** panel reads local run status and uses bounded advice from the existing v91 chat server on port 8791. It checks the selected model is already resident, caps generation, limits requests and rejects malformed or stale results. It does not modify Supermix source, checkpoints, datasets or running jobs. Native server residency is checked immediately before inference, but external server activity can change it; no atomic no-load guarantee is available. See [bridge configuration and limits](docs/supermix-bridge.md). Live external advice is an intervention: future network responses cannot be reproduced from a simulation seed.

The **Circuit Mechanisms** panel reports which model each subsystem is running and what it is doing right now: the E-PG bump's population-vector certainty, the fraction of Kenyon cells the APL loop is leaving active, and which group of neuropils currently holds the descending vote.

Four subsystems ship in two versions so a change can be measured against the code it replaced:

| Subsystem | Current | Legacy |
| --- | --- | --- |
| Central Complex compass | recurrent E-PG ring attractor, estimates heading from turns and drifts | the caller's heading added to a scalar — an oracle, not a model |
| Mushroom body sparseness | APL feedback inhibition; sparseness emerges from gain | fixed top 15% by sorting |
| KC→MBON plasticity | dopamine-gated, depression-dominant, with recovery | symmetric Hebbian |
| Descending output | vote redistributed by threat, gradient and hunger | one fixed weight per role |

```js
new SixteenFlyBrainSyncytium(seed);                      // current
new TwentyTwoFlyBrainSyncytium(seed);                    // expanded default in the app
new SixteenFlyBrainSyncytium(seed, "legacy");            // the circuit it replaced
new SixteenFlyBrainSyncytium(seed, { plasticity: "hebbian" });  // mix
```

Local runs are reproducible from the world seed and interventions; nothing in the engine calls `Math.random` or stamps state with wall-clock time. Version 8 snapshots for the expanded network carry all brain state, learned sensory weights, per-agent memory, action latches, advice and generator states. App snapshots additionally save the climate, terrain, resource state and chemical fields. Version 7 remains the older 16-module format. Browser QA hooks are `window.flyLab`, `window.flySupermix` and `window.render_game_to_text()`.

`src/fly-lif-circuit.js` is a separate spiking module: leaky integrate-and-fire neurons with the parameters and transmitter conventions of the whole-brain model in [Shiu et al. (2024)](https://www.nature.com/articles/s41586-024-07763-9), assembled into a spiking mushroom body. It has no plasticity and is not used by the interactive app.

### Compare circuits

```sh
npm run benchmark:connectome
npm run benchmark:connectome -- --episodes 20 --steps 200 \
  --reference Syncytium_16B_Legacy --output output/connectome.json --csv output/connectome.csv
npm run benchmark:connectome -- --arms RandomWalk,Spiking_MB,Syncytium_16B --episodes 8
npm run benchmark:connectome -- --arms Syncytium_16B,Syncytium_22B,SingleBrain_AL --reference Syncytium_16B --episodes 20 --steps 200
```

Every arm runs the same seeds. The report gives paired percentile bootstrap intervals over seed-level differences, probability of improvement, an interquartile mean and tie-split win shares, plus every raw episode and the source hashes that produced them. An interval straddling zero is not evidence either way.

[Recorded results](docs/validation.md#fly-lab-upgraded-circuits-versus-the-legacy-ones), read carefully. The legacy compass is handed the fly's true heading, so comparing the whole bundle against it mostly measures whether free heading helps. Holding the compass constant, the other three mechanisms come out at +22.95 over 40 seeds with a 95% interval of [−9.2, +56.0]: pointing positive, inconclusive, and costing nothing while implementing what they are named after. Estimating heading rather than being given it costs 145 net score. And a single Antennal Lobe brain still outscores all sixteen, so nothing here says sixteen coupled neuropils outperform one.

## Nexus reliability changes

Async training steps and state changes are serialized. Reset, checkpoint loading, population changes and feature changes pause playback and wait for training. Single-agent evolution works. Old agent models, optimizer state and temporary tensors are disposed during replacement. Policy training now uses valid normalized targets instead of an unsupported TensorFlow.js `sampleWeight` option. Exploration honors the control value and the safety shield preserves a safe sampled action.

Nexus browser checkpoints are partial learning checkpoints, not deterministic snapshots: random generators, optimizer states and all transient model state are not preserved. Historical research labels describe heuristics; the visible labels now distinguish reward normalization, lookahead planning and rule-based feedback from the named research algorithms.

## Validate

```sh
npm test
npm run check
```

Offline tests cover deterministic state, planning, exact resume, malformed imports, experiment cancellation, Nexus lifecycle behavior, and for the Fly Lab: reproducible neurogenesis, exact resume, one environment tick per step whatever the swarm size, per-fly register isolation, credit assignment, the ring attractor's velocity gain and drift, emergent Kenyon-cell sparseness, depression direction and recovery, descending gating, legal moves, the social refractory, the spiking neuron model and the benchmark's statistics. To run the optional real TensorFlow CPU smoke on PowerShell (downloads the pinned runtime):

```powershell
$env:NEXUS_TF_SMOKE = '1'
node --test tests/nexus.test.cjs
```

Browser tests require the optional development dependency and Chromium:

```sh
npm ci
npx playwright install chromium
npm run serve
# In a second terminal:
npm run test:browser
```

Set `BASE_URL` if using another local port. The browser suite exercises all three applications, desktop/mobile layouts, direct-file World Lab use, all strategies/model views, snapshot upload/download, comparison reports, cancellation, Nexus training/reset/checkpoints, and the Fly Lab's three agents, per-fly registers, live mechanisms, legal moves and save/load. Screenshots and receipts are written under ignored `output/`.

Browser QA hooks are available as `window.render_game_to_text()`, `window.advanceTime(ms)` (one tick per 1/60 second, pauses live playback), and `window.diamondLab`. The Fly Lab exposes `window.flyLab` (with `advance(ticks)`) and its own `window.render_game_to_text()`.

The browser suite uses a Chromium already on the machine when it finds one, so set `CHROMIUM_PATH` rather than downloading a second copy. The Nexus section needs a route to `cdn.jsdelivr.net`; without one the suite reports that section as skipped, never as passed.

## Files

| Path | Purpose |
| --- | --- |
| `src/worldlab-core.js` | Shared browser/Node simulation, planners and metrics |
| `src/worldlab-state.js` | Versioned complete snapshot validation and restoration |
| `src/worldlab-experiments.js` | Isolated paired experiments, bootstrap and CSV |
| `src/worldlab.js` | Controls, rendering and browser integration |
| `src/fly-brain-engine.js` | Sixteen *Drosophila* neuropil models, shared connectome, per-fly registers |
| `src/fly-environment.js` | Seeded weather, terrain, predators, resources and God Mode operations |
| `src/fly-supermix-client.js`, `scripts/supermix-bridge.cjs` | Read-only telemetry and bounded verified model advice |
| `src/fly-lif-circuit.js` | Spiking leaky integrate-and-fire circuits and a spiking mushroom body |
| `src/connectome-benchmark.js` | Fly Lab arms, paired statistics and the arena they run in |
| `fly-diamond-nexus.html` | Fly Lab: world, connectome view, inspector and telemetry |
| `diamond-nexus.html` | Existing Nexus simulation and its targeted reliability fixes |
| `tests/`, `scripts/` | Regression tests, serving and reproducible comparisons |
| `docs/` | Research mapping, limits and measured evidence |

MIT license; see [LICENSE](LICENSE). Contributions should include focused behavior checks and measured evidence for improvement claims.
