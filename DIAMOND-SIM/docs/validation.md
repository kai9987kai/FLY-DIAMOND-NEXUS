# Validation and measured improvement

## Fly Lab: upgraded circuits versus the legacy ones

Three circuits in the Fly Lab carried the name of a fly structure without its mechanism, and the descending vote treated all sixteen neuropils as equals. Each replacement is selectable, so the comparison is against the code it replaced rather than against nothing. The [raw receipt](benchmarks/connectome-upgrade.json) records source SHA-256 hashes, the seed set, every per-seed episode and the bootstrap settings.

Protocol fixed before running: seeds 1001 to 2388 in steps of 73, twenty of them, 200 steps per episode, a 16×16 arena with 8 diamonds and 4 hazards, every arm on the same seeds. Reference arm `Syncytium_16B_Legacy`. Intervals are paired percentile bootstrap over seed-level differences, 2,000 resamples, bootstrap seed 20260912. No parameter was changed after seeing these numbers.

| Arm | Net score | IQM | Diamonds | Hazards | Cells seen | Win share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RandomWalk | 21.80 | 11.0 | 1.75 | 1.15 | 51.45 | 10.0% |
| SingleBrain_AL | 283.60 | 179.3 | 11.10 | 0 | 45.00 | 60.0% |
| CentralComplex_8B | 118.45 | 88.1 | 4.60 | 0 | 31.65 | 20.0% |
| Syncytium_16B_Legacy | 33.75 | 25.0 | 1.35 | 0 | 13.65 | 2.5% |
| **Syncytium_16B** | **64.40** | **37.5** | **2.50** | **0** | **18.35** | **7.5%** |

| Arm | Difference from legacy | 95% interval | P(improvement) | Clears zero |
| --- | ---: | --- | ---: | --- |
| RandomWalk | −11.95 | [−37.00, +15.05] | 0.35 | no |
| SingleBrain_AL | +249.85 | [+131.23, +387.64] | 0.95 | yes |
| CentralComplex_8B | +84.70 | [+44.74, +127.71] | 0.90 | yes |
| Syncytium_16B | **+30.65** | **[+5.00, +65.62]** | 0.68 | yes |

The upgraded 16-brain syncytium beats the circuit it replaced by **+30.65 net score per episode**, with an interval that clears zero, though not by much. Net score is `25 × diamonds − 20 × hazards − 8 × stasis + floor(0.2 × energy)`; win shares split ties evenly.

Rolling each mechanism back on its own, over the same 20 seeds, shows every one of them contributing:

| Configuration | Net score |
| --- | ---: |
| All four upgraded mechanisms | **64.40** |
| Kinematic compass instead of the ring attractor | 51.00 |
| Top-k selection instead of APL feedback | 55.55 |
| Hebbian instead of dopamine-gated depression | 50.35 |
| Flat descending vote instead of gating | 36.25 |
| All four legacy (the reference arm) | 33.75 |

Three results are reported because they are true, not because they flatter the change:

- **A single Antennal Lobe brain scores 4.4× the full syncytium** (283.60 against 64.40), and beats it on every metric reported here, coverage included. Adding neuropils does not help in this arena; it hurts, substantially. State-dependent gating is the largest single contributor to the syncytium's score and still leaves it far behind. Closing that gap is the clearest piece of work left, and nothing here should be read as evidence that sixteen coupled neuropils outperform one.
- **The spiking arm is inconclusive.** Over 8 seeds at 120 steps, `Spiking_MB` scored +5.00 against a random walk with an interval of [−35.76, +46.25]. It is a fixed circuit with no plasticity and no navigation, so this is the expected result; it is included to check that a spiking implementation behaves sensibly in the loop, not to win. On that seed set the syncytium's own interval against a random walk also straddles zero.
- **An earlier revision of this page reported +95.85 for the same comparison.** That measurement was taken while the ring attractor silently reversed for turns of half a circle, which on a four-direction grid is every direction reversal, and while the single-brain arm's plasticity was a no-op. Both are fixed; these are the numbers from the corrected code.

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
| E-PG ring attractor | Angular-velocity gain 0.99–1.01 over ±0.4 rad per tick and within ±50% out to ±3.14; heading held within 0.15 rad over 60 idle ticks; a 0.045 celestial anchor cuts accumulated drift from 0.17 rad to 0.004 rad over 300 wobbly ticks, and does not drag the bump across the ring. A turn of exactly half a circle is direction-ambiguous and is resolved consistently; the two choices reach the same heading. |
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
| The ring attractor's rotation wrapped past half a turn | A direction reversal, which is exactly half a turn and the commonest event on a four-direction grid, ran the compass backwards: measured gain −0.89 at π. |
| A brain used outside a syncytium was never told which action it took | The dopamine-gated rule treats "no action" as "every channel was taken", so the update carried no direction and the `SingleBrain_AL` arm did not learn at all. Its score went from 161.00 to 283.60 once fixed. |
| Plasticity credited the syncytium's own argmax | The executed action can differ after policy mixing, the legality filter or a commitment latch. Measured at 12% of ticks: those punishments depressed a channel the fly never used. |
| The value estimate behind the prediction error was a single shared scalar | One fly's outcome was scored against another fly's estimate of its situation. |
| A new fly inherited the previous one's Kenyon-cell activations | The pristine record was captured before any neurons existed, so the restore loop copied nothing and left the previous fly's activity in place. |
| The spike-to-PSP delay line was written one slot early | Postsynaptic potentials arrived 1.5 ms after a spike instead of the documented 1.8 ms, and the test's one-timestep slack hid it. |
| Telemetry read per-fly registers off the shared brains | The Circuit Mechanisms panel silently switched which individual it was describing whenever a handshake started or stopped. |

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

Current working version: **147/148 Node tests pass** (the optional TensorFlow download test is skipped offline), and **38 Chromium browser checks pass**. The Nexus browser section needs `cdn.jsdelivr.net` for TensorFlow.js and Chart.js; where there is no route to it the suite reports that section as skipped and never as passed. JavaScript syntax, local asset and HTML ID checks pass.

Test coverage added for the Fly Lab: `tests/fly-brain-upgrades.test.cjs` (determinism, exact resume, one tick per environment step, per-fly register isolation, credit assignment, the ring attractor, APL sparseness, dopamine-gated depression, descending gating, heading from motion, legal moves, the social refractory and the snapshot contract), `tests/fly-lif.test.cjs` (the spiking neuron model) and `tests/connectome-stats.test.cjs` (the statistics and the benchmark runner's contract).

Historical figures for the previous version follow.

Earlier checks on the pre-Fly-Lab version: **40/40 tests passed** with the real TensorFlow smoke enabled, and **35/35 Chromium browser checks passed**. JavaScript syntax/local asset/HTML ID checks and `git diff --check` passed. The installed web-game client also produced valid state and inspected screenshots. Default offline tests skip only the optional TensorFlow download test.

`npm test` covers deterministic seeded behavior, low-energy planning, correct prediction residuals, exact save/resume across reward pulses and respawns, all planners, truncated history, malformed snapshots, bootstrap reproducibility, equal budgets, cooperative cancellation and Nexus lifecycle behavior.

The optional `NEXUS_TF_SMOKE=1` test uses the actual pinned TensorFlow.js CPU runtime to train a policy and check tensor ownership during evolution, reset and checkpoint replacement. Default offline tests skip this network-dependent check.

`npm run test:browser` checks both apps with actual Chromium and CDN libraries, World Lab direct-file loading, strategy/model/chart controls, precise snapshot parameters, upload/download, invalid import preservation, duplicate animation prevention, swarm labels, isolated experiments, JSON/CSV results, cancellation and desktop/mobile width. Screenshots are inspected separately for layout and visible behavior.

World Lab rendering now occurs once per live batch rather than every logical step. Live batches stop after their time budget; this is an implementation change, not a measured cross-version speedup claim. Large beam/agent settings can still be expensive. Nexus neural training remains substantially heavier.
