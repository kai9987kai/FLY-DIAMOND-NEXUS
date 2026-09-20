# Validation and measured improvement

## Fly Lab: upgraded circuits versus the legacy ones

Three circuits in the Fly Lab carried the name of a fly structure without its mechanism, and the descending vote treated all sixteen neuropils as equals. Each replacement is selectable, so the comparison is against the code it replaced rather than against nothing. The [raw receipt](benchmarks/connectome-upgrade.json) records source SHA-256 hashes, the seed set, every per-seed episode and the bootstrap settings.

Protocol fixed before running: seeds 1001 to 2388 in steps of 73, twenty of them, 200 steps per episode, a 16×16 arena with 8 diamonds and 4 hazards, every arm on the same seeds. Reference arm `Syncytium_16B_Legacy`. Intervals are paired percentile bootstrap over seed-level differences, 2,000 resamples, bootstrap seed 20260912.

| Arm | Net score | IQM | Diamonds | Hazards | Cells seen | Win share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RandomWalk | 21.80 | 11.0 | 1.75 | 1.15 | 51.45 | 5.0% |
| SingleBrain_AL | 161.00 | 132.6 | 6.40 | 0 | 29.00 | 41.3% |
| CentralComplex_8B | 156.00 | 121.1 | 6.00 | 0 | 40.80 | 28.7% |
| Syncytium_16B_Legacy | 33.75 | 25.0 | 1.35 | 0 | 13.65 | 1.3% |
| **Syncytium_16B** | **129.60** | **91.5** | **5.00** | **0** | **48.15** | **23.8%** |

| Arm | Difference from legacy | 95% interval | P(improvement) | Clears zero |
| --- | ---: | --- | ---: | --- |
| RandomWalk | −11.95 | [−37.00, +15.05] | 0.35 | no |
| SingleBrain_AL | +127.25 | [+82.55, +174.81] | 0.95 | yes |
| CentralComplex_8B | +122.25 | [+71.85, +174.41] | 0.93 | yes |
| Syncytium_16B | **+95.85** | **[+47.99, +152.65]** | 0.88 | yes |

The upgraded 16-brain syncytium beats the circuit it replaced by **+95.85 net score per episode**, with an interval that clears zero, and it visits 48.15 cells to the legacy arm's 13.65. Net score is `25 × diamonds − 20 × hazards − 8 × stasis + floor(0.2 × energy)`; win shares split ties evenly.

Two results are reported because they are true, not because they flatter the change:

- **A single Antennal Lobe brain still scores higher than all sixteen** (161.00 against 129.60), and the 8-brain Central Complex subset is close behind it. Adding neuropils does not help in this arena. Gating the descending vote closed most of the gap — before it, the full syncytium scored 121.7 against the same 161 — but not all of it. On coverage the ordering reverses: 48.15 cells against 29.00.
- **The spiking arm is inconclusive.** Over 8 seeds at 120 steps, `Spiking_MB` scored +21.75 against a random walk with an interval of [−14.13, +58.00]. It is a fixed circuit with no plasticity and no navigation, so this is the expected result; it is included to check that a spiking implementation behaves sensibly in the loop, not to win.

This is one reduced arena and one convenience seed set, not a held-out benchmark. Equal step budgets are not equal computation: the spiking arm costs roughly an order of magnitude more per episode than the rate-coded ones.

Reproduce with:

```sh
npm run benchmark:connectome -- --episodes 20 --steps 200 \
  --reference Syncytium_16B_Legacy --output output/connectome.json
```

### Mechanism measurements

Each replaced circuit was measured directly, and the numbers are asserted in `tests/fly-brain-upgrades.test.cjs` and `tests/fly-lif.test.cjs` so they cannot drift silently.

| Mechanism | Measurement |
| --- | --- |
| E-PG ring attractor | Angular-velocity gain 0.99–1.01 over ±0.4 rad per tick; heading held within 0.15 rad over 60 idle ticks; a 0.045 celestial anchor cuts accumulated drift from 0.17 rad to 0.004 rad over 300 wobbly ticks, and does not drag the bump across the ring. |
| APL feedback inhibition | Active Kenyon cells 18.8% at weak drive, 15.6% at mid, 6.3% at 15× drive, with APL activity rising in step. The legacy top-k mode gives the identical fraction at every drive, by construction. |
| Dopamine-gated depression | Punishment depresses the taken channel; reward leaves the taken channel stronger relative to every alternative; with dopamine silent, depressed synapses recover toward baseline. |
| Descending gating | Threat raises the reflex group's share and lowers exploration's; a gradient raises the goal group's; hunger amplifies a weak gradient; total descending weight is conserved to within 1e-3. |
| Spiking mushroom body | APL engaged takes active Kenyon cells from 64% to 36% in the reduced circuit, and to 21% at the fly's claw-to-glomerulus ratio. Refractory ceiling respected; PSP arrival respects the 1.8 ms delay. |

### Defects found by measuring

Most of these surfaced only by driving the app and by reporting per-seed statistics instead of means.

| Defect | Effect before the fix |
| --- | --- |
| Heading derived from bearing from world centre, not travel direction | Agents drove into the nearest wall and stayed. Fixing it took the app's legacy configuration from 0.7 to 4.0 mean diamonds and 34 to 118 cells visited. |
| `resolveAgents` never checked move legality | A fly facing a wall stood still, accrued dwell ticks and was penalised for stasis it could not avoid. |
| Social resonance paid every tick it was in range | Huddling out-earned foraging: 65% of ticks in resonance with energy pinned near maximum. Now rate-limited below the metabolic cost of a tick. |
| Win rate awarded ties to the first arm listed | `RandomWalk` was listed first. |
| Neurogenesis drew from `Math.random`, snapshots restored a draw count but not generator state | The same world seed grew different Kenyon cells on every run, and a resumed run silently diverged. |

## Frozen original comparison

The recorded [raw receipt](benchmarks/original-vs-v3.json) compares the unchanged original World Lab at `3abf50785a178e1f78e216cc10dce66928ce0760` with the current full core. It records source SHA-256 hashes, runtime, parameters, per-seed initial-state hashes and raw outcomes.

Protocol fixed before running: seeds 1–20, two agents, 300 ticks per run, default shared learning/world settings, beam planner for the candidate. All 20 pairs began from identical common simulation state, including model arrays and normalized RNG state. The final comparison was rerun after the energy-depletion and open-border planning fixes. No settings were tuned after inspecting this comparison.

| Mean metric | Original | Updated |
| --- | ---: | ---: |
| Cumulative extrinsic reward per agent | 145.4488 | 149.5952 |
| Cells sensed per agent | 8.3486% | 15.7472% |
| Respawns per run | 3.05 | 1.05 |
| Hazard hits per run | 0.15 | 0.15 |
| Collisions per run | 0 | 0 |
| Whole-grid model MAE | 2.4136 | 2.2167 |
| Remaining energy per agent | 45.755 | 63.280 |

The primary reward difference is **+4.1464 per agent**, with a 95% paired percentile bootstrap interval of **[+0.7665, +7.5405]** (2,000 resamples; bootstrap seed 20260912). This supports a reward advantage for this configuration. It evaluates the complete update, so it does not isolate beam search from the other correctness changes.

The seed set is a convenience sample, and some individual seeds favor the original. This is not a held-out multi-task benchmark or proof of superiority on every setting or metric. The original runs in a Node VM while the candidate uses CommonJS; recorded timings therefore cannot establish a speedup. Nexus is excluded from this reward comparison.

Reproduce with `npm run benchmark:original`. The script requires the original commit in local Git history and writes a fresh receipt to `output/comparison-original.json`. If core source hashes change, the checked-in receipt describes the recorded version until re-run.

## Planner-only comparisons

The first preliminary within-current-core comparisons used seeds 11, 29, 47, 71 and 101; 150 ticks; two agents; unchanged defaults. These compare strategies with the same surrounding fixes, unlike the frozen-version experiment above.

| Baseline | Beam minus baseline reward per agent | 95% paired interval |
| --- | ---: | --- |
| Original shooting planner | +2.0251 | −4.4564 to +11.7063 |
| Greedy + Q | +4.8262 | +0.6593 to +11.9120 |
| Random legal actions | +13.7274 | +6.6472 to +22.3298 |

The shooting-planner comparison was inconclusive and beam had +0.2 hazard hits per run in this small sample. The product retains the original planner and exposes these tradeoffs instead of selecting a universal winner.

## Regression and browser checks

Current working version: **137/138 Node tests pass** (the optional TensorFlow download test is skipped offline), and **38 Chromium browser checks pass**. The Nexus browser section needs `cdn.jsdelivr.net` for TensorFlow.js and Chart.js; where there is no route to it the suite reports that section as skipped and never as passed. JavaScript syntax, local asset and HTML ID checks pass.

Test coverage added for the Fly Lab: `tests/fly-brain-upgrades.test.cjs` (determinism, exact resume, one tick per environment step, per-fly register isolation, credit assignment, the ring attractor, APL sparseness, dopamine-gated depression, descending gating, heading from motion, legal moves, the social refractory and the snapshot contract), `tests/fly-lif.test.cjs` (the spiking neuron model) and `tests/connectome-stats.test.cjs` (the statistics and the benchmark runner's contract).

Historical figures for the previous version follow.

Earlier checks on the pre-Fly-Lab version: **40/40 tests passed** with the real TensorFlow smoke enabled, and **35/35 Chromium browser checks passed**. JavaScript syntax/local asset/HTML ID checks and `git diff --check` passed. The installed web-game client also produced valid state and inspected screenshots. Default offline tests skip only the optional TensorFlow download test.

`npm test` covers deterministic seeded behavior, low-energy planning, correct prediction residuals, exact save/resume across reward pulses and respawns, all planners, truncated history, malformed snapshots, bootstrap reproducibility, equal budgets, cooperative cancellation and Nexus lifecycle behavior.

The optional `NEXUS_TF_SMOKE=1` test uses the actual pinned TensorFlow.js CPU runtime to train a policy and check tensor ownership during evolution, reset and checkpoint replacement. Default offline tests skip this network-dependent check.

`npm run test:browser` checks both apps with actual Chromium and CDN libraries, World Lab direct-file loading, strategy/model/chart controls, precise snapshot parameters, upload/download, invalid import preservation, duplicate animation prevention, swarm labels, isolated experiments, JSON/CSV results, cancellation and desktop/mobile width. Screenshots are inspected separately for layout and visible behavior.

World Lab rendering now occurs once per live batch rather than every logical step. Live batches stop after their time budget; this is an implementation change, not a measured cross-version speedup claim. Large beam/agent settings can still be expensive. Nexus neural training remains substantially heavier.
