# DIAMOND SIM

Two educational browser simulations for exploring learning agents. Open **[index.html](index.html)** to choose a lab.

- **[World Lab](worldlab.html)**: deterministic reward-map learning, four strategies, inspectable planning, exact snapshots, paired-seed comparisons and downloadable evidence. Works offline with no build step.
- **[Diamond Nexus](diamond-nexus.html)**: the existing larger simulation with neural experts, evolution, terrain, dynamic obstacles, curiosity and feature controls. Loads pinned TensorFlow.js and Chart.js from a public CDN.

These are simplified research sandboxes. They do not reproduce DIAMOND, Dreamer, TD-MPC2 or state-of-the-art RL results. See [research and limits](docs/research.md).

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

## Nexus reliability changes

Async training steps and state changes are serialized. Reset, checkpoint loading, population changes and feature changes pause playback and wait for training. Single-agent evolution works. Old agent models, optimizer state and temporary tensors are disposed during replacement. Policy training now uses valid normalized targets instead of an unsupported TensorFlow.js `sampleWeight` option. Exploration honors the control value and the safety shield preserves a safe sampled action.

Nexus browser checkpoints are partial learning checkpoints, not deterministic snapshots: random generators, optimizer states and all transient model state are not preserved. Historical research labels describe heuristics; the visible labels now distinguish reward normalization, lookahead planning and rule-based feedback from the named research algorithms.

## Validate

```sh
npm test
npm run check
```

Offline tests cover deterministic state, planning, exact resume, malformed imports, experiment cancellation and Nexus lifecycle behavior. To run the optional real TensorFlow CPU smoke on PowerShell (downloads the pinned runtime):

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

Set `BASE_URL` if using another local port. The browser suite exercises both applications, desktop/mobile layouts, direct-file World Lab use, all strategies/model views, snapshot upload/download, comparison reports, cancellation and Nexus training/reset/checkpoints. Screenshots and receipts are written under ignored `output/`.

Browser QA hooks are available as `window.render_game_to_text()`, `window.advanceTime(ms)` (one tick per 1/60 second, pauses live playback), and `window.diamondLab`.

## Files

| Path | Purpose |
| --- | --- |
| `src/worldlab-core.js` | Shared browser/Node simulation, planners and metrics |
| `src/worldlab-state.js` | Versioned complete snapshot validation and restoration |
| `src/worldlab-experiments.js` | Isolated paired experiments, bootstrap and CSV |
| `src/worldlab.js` | Controls, rendering and browser integration |
| `diamond-nexus.html` | Existing Nexus simulation and its targeted reliability fixes |
| `tests/`, `scripts/` | Regression tests, serving and reproducible comparisons |
| `docs/` | Research mapping, limits and measured evidence |

MIT license; see [LICENSE](LICENSE). Contributions should include focused behavior checks and measured evidence for improvement claims.
