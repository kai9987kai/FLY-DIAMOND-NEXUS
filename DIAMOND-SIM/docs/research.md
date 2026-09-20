# Research, implementation and limits

Reviewed September 2026. Primary sources below informed this upgrade. These are educational browser simulations, with no claim of reproducing the papers' architectures or benchmark scores.

| Source | Relevant idea | What this project implements |
| --- | --- | --- |
| [DIAMOND — Diffusion for World Modeling: Visual Details Matter in Atari](https://diamond-wm.github.io/) (NeurIPS 2024) | Action-conditioned world prediction, with attention to rollout error | An inspectable reward-map learning loop. Grid-field diffusion is spatial averaging, not learned image generation or a diffusion world model. |
| [TD-MPC2](https://www.tdmpc2.com/) (ICLR 2024) | Planning with learned predictions and terminal values | A discrete beam search with a terminal tabular Q estimate, virtual visit counts, single-use energy pickups and observation-confidence penalty. No latent encoder, continuous-action optimizer or neural ensemble. |
| [Dreamer 4 — Training Agents Inside of Scalable World Models](https://danijar.com/project/dreamer4/) ([2025 paper](https://arxiv.org/abs/2509.24527)) | Train behavior in imagination, then evaluate in the real environment | Separate imagined paths from executed transitions and independently evaluate candidate/baseline runs. This lab does not train video models or implement Dreamer's policy training. |
| [Deep RL at the Edge of the Statistical Precipice](https://arxiv.org/abs/2108.13264), [rliable](https://github.com/google-research/rliable) (NeurIPS 2021) | Account for uncertainty across runs instead of relying on a single score | Paired seeds, raw observations, deterministic percentile bootstrap intervals and explicit partial/cancelled results. A lightweight implementation, not the rliable package or its full multi-task evaluation suite. |

## World Lab model

The environment is a 60 × 60 grid. Agents sense and learn a scalar reward field through local exponential averaging. Their tabular Q values also receive imagined one-step updates. Actual visit counts produce `1 / sqrt(visits + 1)` novelty. The displayed uncertainty decreases with observations; it is a confidence heuristic and is not a calibrated probability, Bayesian posterior or ensemble disagreement estimate.

Geometry, current hazard locations and energy locations are available to planning. Reward values use learned beliefs. Future hazard motion and reward pulses are not predicted. Agents act sequentially and can overlap; a resource consumed by an earlier agent is unavailable to later agents in that tick. Distance-weighted reward sharing excludes the sender's own observations. It is not a graph attention network.

Beam search retains a bounded set of candidate paths at every depth. Within each path, revisits reduce novelty and each energy pickup can be collected once. Lower energy increases the value of a pickup. A path ends when its imagined energy is depleted, so it cannot claim pickups past a respawn boundary. The model-caution setting penalizes uncertain reward predictions. The original random-shooting planner and greedy/Q policy remain selectable, along with random legal actions. The displayed trajectory is the path actually scored, including the already-executed first move.

The beam budget is retained paths per depth; the shooting budget is approximate sampled trajectories plus the existing Dyna updates. Equal numeric budgets are **not equal compute**. Both planners use a terminal/immediate-value heuristic, and neither guarantees optimal actions or greater reward on every seed.

## Experiments

Each candidate/baseline pair uses the same seed, agent count, learning settings and number of executed ticks. Runs start fresh; no live-world learning or random state leaks into them. Resource interaction can cause their future environment randomness to diverge, so matching seeds guarantee identical initial conditions, not identical future events under different actions.

The main outcome is cumulative extrinsic reward divided by agent count. Curiosity is reported separately and is not counted as task reward. Per-seed coverage, hazard hits, collisions, respawns, remaining energy and whole-grid model MAE expose tradeoffs. Coverage is the mean fraction of cells sensed per agent, not union coverage. MAE includes unseen cells.

The 95% percentile interval resamples whole paired-seed reward differences 2,000 times, using a separate seeded generator. Fewer than two completed seeds produce no interval. Cancellation keeps only complete pairs. Five seeds are preliminary; wider seed sets and different horizons are needed for stronger conclusions. Seed sets used during development are not held-out evaluation.

## Snapshot contracts

World Lab v3 preserves every random generator, environment phase, ordered replay-state list, model array, agent path, counters, parameters and rolling history. Validation checks shapes, finite values, IDs, legal positions and consistency before replacing the live run. Files over 16 MB are rejected. Version 2 lacks random state and cannot guarantee exact continuation; it is rejected with a specific explanation.

Nexus uses a separate browser-local checkpoint format. It retains the existing checkpoint functionality but is not an exact replay mechanism: random state, optimizer state and several transient models are not checkpointed. Its learning networks and heuristic features are not PPO, GRPO, MCTS or RLAIF implementations despite historical names in the source.

## Performance and portability

World Lab runs offline with classic scripts and no build step. Node tests use the same engine as the browser. Rendering is separated from simulation ticks, and live batches yield at a frame budget. Experiments yield between short chunks, but a single high-budget tick can still be expensive; twelve agents with the maximum beam width/horizon is a deliberate stress setting.

Nexus loads pinned TensorFlow.js and Chart.js from their public CDN. Neural training remains substantially heavier and less reproducible than World Lab. Runtime tests distinguish fallback operation from actual TensorFlow training.
