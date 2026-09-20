# Validation and measured improvement

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

Final checks on this working version: **40/40 tests passed** with the real TensorFlow smoke enabled, and **35/35 Chromium browser checks passed**. JavaScript syntax/local asset/HTML ID checks and `git diff --check` passed. The installed web-game client also produced valid state and inspected screenshots. Default offline tests skip only the optional TensorFlow download test.

`npm test` covers deterministic seeded behavior, low-energy planning, correct prediction residuals, exact save/resume across reward pulses and respawns, all planners, truncated history, malformed snapshots, bootstrap reproducibility, equal budgets, cooperative cancellation and Nexus lifecycle behavior.

The optional `NEXUS_TF_SMOKE=1` test uses the actual pinned TensorFlow.js CPU runtime to train a policy and check tensor ownership during evolution, reset and checkpoint replacement. Default offline tests skip this network-dependent check.

`npm run test:browser` checks both apps with actual Chromium and CDN libraries, World Lab direct-file loading, strategy/model/chart controls, precise snapshot parameters, upload/download, invalid import preservation, duplicate animation prevention, swarm labels, isolated experiments, JSON/CSV results, cancellation and desktop/mobile width. Screenshots are inspected separately for layout and visible behavior.

World Lab rendering now occurs once per live batch rather than every logical step. Live batches stop after their time budget; this is an implementation change, not a measured cross-version speedup claim. Large beam/agent settings can still be expensive. Nexus neural training remains substantially heavier.
