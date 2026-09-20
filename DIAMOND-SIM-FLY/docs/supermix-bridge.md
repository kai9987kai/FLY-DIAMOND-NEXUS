# Read-only Supermix bridge

Run the simulation with `npm run serve`. The local server includes
`GET /api/supermix/status` and `POST /api/supermix/advice`, on the same origin as
the simulation. It binds to `127.0.0.1` and accepts local same-origin API calls.

The bridge never edits Supermix, imports Python modules, loads a checkpoint,
starts training/inference, or stops, pauses, or restarts an existing process.
No GPU model is launched. Training logs are telemetry, not evidence that the
corresponding model is serving or has been promoted.

## Telemetry

The default read-only directory is
`%USERPROFILE%\Desktop\New folder (9)\Supermix`.
`SUPERMIX_ROOT` may select another local checkout when launching the simulation
server. Browser requests cannot select a directory, filename, or remote URL.

Every ten seconds at most, the bridge reads the last 16 KiB of five fixed files:
the v92 run log and launch script, v93 chain and training logs, and v91 analysis
log. It returns small structured metadata and available step/loss metrics, never
raw logs or checkpoint contents. Recent file modification is explicitly marked
as log activity; it does not prove that a training process is alive.

At the read-only inspection on 20 September 2026, the v92 folder contained
`run_v92.sh` and no v92 log or checkpoint. The script waits for completion of
the v91 analysis. A live Python process was evaluating the v91 rewired checkpoint
as part of the v93 shell chain. No Supermix inference listener was observed.
These observations are a snapshot; the live status route rereads the fixed logs.

## Optional existing inference service

Advice is unavailable by default. To use an **already resident** v92 inference
service that implements the contract below, set `SUPERMIX_ENDPOINT` before
launching this simulation server. Only a plain HTTP loopback origin is accepted,
for example `http://127.0.0.1:8092`. Redirects and browser-provided endpoints are
rejected. Configuring an endpoint does not launch anything.

The endpoint must expose:

- `GET /health`: JSON `{ "model": "v92", "loaded": true, "noLoad": true,
  "inferenceOnly": true }`. These fields are the service's assertion that it
  already holds v92 and inference cannot load a checkpoint or control training.
- `POST /advice`: accepts `{schemaVersion:1,model:"v92",noLoad:true,
  actionOrder:["up","down","left","right"],observation:{tick,agents,world}}`.
  It returns `{source:"model",model:"v92",agents:{agent1:[0,0,0,0],...}}`.
  Each requested agent must have exactly four finite action values in [-1,1].

Health is rechecked before every advice request. The bundled native Supermix
`/api/chat` endpoint is deliberately not called: its registry can lazily load a
checkpoint. An ordinary model-list response is insufficient to enable advice.
There is no automatic adapter process and no heuristic substitute. Endpoint
identity is service-reported, not a cryptographic attestation of model weights.

The bridge admits one advice request every ten seconds with only one in flight.
Health has a 1.5-second deadline and advice has a 3.5-second deadline. Three
failures trigger a 60-second cooldown. Requests are limited to 12 KiB and service
responses to 32 KiB. The bridge binds accepted advice to the requested tick,
sets a 30-tick lifetime and 0.2 influence, and rejects wrong model identities,
missing/extra agents, and malformed vectors. The simulation independently
checks freshness and bounds before applying advice.

## Browser API

Status response:

```json
{
  "schemaVersion": 1,
  "targetModel": "v92",
  "mode": "telemetry-only",
  "training": {
    "state": "prepared",
    "phase": "awaiting-evidence",
    "lastUpdate": null,
    "metrics": {"step": null, "totalSteps": null, "loss": null},
    "message": "v92 launch script found; no v92 run log. Active v92 training is unverified.",
    "activity": []
  },
  "inference": {"configured": false, "ready": false, "verifiedModel": null, "reason": "No already-serving v92 endpoint is configured; telemetry only.", "retryAt": null},
  "safety": {"readOnly": true, "minAdviceIntervalMs": 10000, "maxInfluence": 0.35, "maxConcurrentRequests": 1, "loadsCheckpoints": false}
}
```

`training.state` may also be `unavailable`, `log-updating`, `idle`, or
`log-complete`. Mode is `inference-ready` only after the resident/no-load health
contract is satisfied; otherwise it is `telemetry-only` or `unavailable`.

POST a compact observation with a nonnegative integer `tick`, one to three
agent entries named `agent1`, `agent2`, `agent3`, each with finite `x` and `y`,
and optional compact `world` data. A successful response is:

```json
{"schemaVersion":1,"source":"model","model":"v92","advice":{"tick":10,"ttl":30,"influence":0.2,"agents":{"agent1":[0.1,-0.2,0,1]}}}
```

Failures use a non-2xx status and `{ "error": "machine_code", "reason": "Explanation" }`.
An unavailable service never produces model advice. This connection is optional;
the deterministic local simulation continues independently.
