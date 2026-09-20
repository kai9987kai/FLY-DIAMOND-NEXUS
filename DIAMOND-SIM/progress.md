Original prompt: innovate advance and improve whole project look at best and new research to help add new features and refine and make sure its better then orignial versions in every way possible

## Design and acceptance

Upgrade both existing simulations without removing their modes. World Lab gets a reusable deterministic engine, strict complete snapshots, truthful rollout rendering, selectable beam planning, and cancellable paired-seed comparisons. Nexus gets targeted async lifecycle and single-agent fixes. A shared launch page and accurate research/usage documentation make both discoverable.

Research reviewed: DIAMOND (NeurIPS 2024), TD-MPC2 (ICLR 2024), Dreamer 4 (2025), and rliable evaluation methodology. These inform planning/evaluation design; browser heuristics are not implementations of those neural systems.

Validation: Node regression tests, paired-seed raw evidence, browser controls and snapshot round trips, desktop/mobile screenshots, JavaScript syntax checks, git diff --check. Universal superiority is not an acceptance claim; report measured gains and tradeoffs.

## Work log

- Initial checkout clean on main, baseline 3abf507. Two standalone HTML applications, no test infrastructure. README describes an older version.
- Extracted World Lab engine and UI into classic scripts, preserving direct-file use.
- Audit found incomplete snapshots, duplicate animation chains, misleading imagined paths, Nexus async mutation races and one-agent evolution crash.
- Completed World Lab classic-script extraction, energy-aware beam search, correct rollout rendering, independent agent inspection, strict v3 snapshots, paired experiments, cancellation and exports.
- Completed Nexus training/lifecycle fixes, single-agent evolution, model disposal, normalized TensorFlow policy targets, epsilon/shield behavior, staged atomic checkpoint loading and truthful partial-checkpoint messaging.
- Added launch page, research mapping, usage guide, local server, locked optional browser QA dependency and original-version comparison harness.
- Independent review reproduced open-border and energy-depletion planning errors; added failing regressions and corrected both before final measurements.
- Final validation: 40/40 tests passed with NEXUS_TF_SMOKE=1; 35/35 Chromium browser checks passed; JavaScript/local-script/HTML-ID checks and git diff --check passed. Installed web-game client passed with screenshot/text output, visually inspected. Desktop/mobile screenshots inspected; mobile Run/Step controls moved above world.
- Final frozen-original comparison: 20 identical initial-state seed pairs, 300 steps, 2 agents. Reward/agent 149.5952 vs 145.4488; paired delta +4.1464, 95% interval [0.7665, 7.5405]. Coverage 15.7472% vs 8.3486%; respawns/run 1.05 vs 3.05; hazards equal 0.15. Receipt hashes verified against current core/experiment/comparison sources.
- Evidence and reproducible commands are in docs/validation.md; raw original comparison is tracked under docs/benchmarks/. Runtime/browser artifacts remain ignored under output/.

## Remaining scope limits

- Completed this improvement set without committing or pushing. Existing branch remains main.
- No universal superiority or speedup claim: the full-version benchmark covers one fixed configuration, and its timing uses different execution contexts. Preliminary within-core beam-vs-shooting comparison is inconclusive.
- World Lab v2 snapshots lack RNG state and are rejected for exact replay. Nexus checkpoints remain explicitly partial. Larger neural world models, faithful paper implementations, representative held-out multi-task evaluation and long-horizon performance work are future projects.
