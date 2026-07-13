# RailCross — Railway Crossing Delay Assistant

RailCross is an AI/ML prototype for a simple real-world commuter problem: an unexpected railway-gate closure can create a queue and make a route take longer. It uses traffic movement near a level crossing to estimate whether the gate is likely open or closed, then helps users consider the delay while planning a journey.

## Live Demo

Visit the deployed application: [railcross-ai.adarshprivate678.workers.dev](https://railcross-ai.adarshprivate678.workers.dev)

## The Problem It Addresses

Drivers and commuters often do not know that a level crossing is closed until they reach the queue. RailCross explores whether traffic behaviour can provide an early signal: cars stopped on both approaches for longer increase the chance of a closed gate; when traffic begins moving, the chance falls.

## How the Prototype Works

1. The app displays mapped railway-crossing locations.
2. A traffic snapshot contains delay and stopped-time signals for each location.
3. A Histogram Gradient Boosting classifier predicts `OPEN`, `CLOSED`, or — when the closure probability falls inside a validation-tuned uncertainty band or the observation is stale — `UNKNOWN` instead of guessing.
4. The map explains the prediction in plain language and can use it while comparing routes.

The live map has two modes. **Model snapshot** (default) shows the trained classifier's OPEN/CLOSED/UNKNOWN output for a synthetic traffic snapshot at each crossing. **Demo cycle** is a 30-minute animated traffic pattern that updates once per minute, so users can watch the prediction change from closed to open when simulated cars begin moving.

**Current evidence is synthetic only.** The model is trained and tested on a reproducible event-driven simulator, not real gate telemetry. The web demo does not claim live gate status. See [ML project documentation](docs/ML_PROJECT.md) and the [field-validation protocol](docs/PILOT_VALIDATION_PROTOCOL.md) before making any operational or accuracy claim.

The model schema is documented in [Google Routes data contract](docs/GOOGLE_ROUTES_DATA_CONTRACT.md). It mirrors only fields available through the Routes API or values calculated from repeated route polls.

## Key Features Built & Implemented

1. **Crowdsourced Verification**: Live API endpoint (`/api/reports`) for users to report gate state with geofenced GPS verification (max 500m proximity).
2. **Real-time Traffic Pipeline**: Standalone poller (`routes_poller.py`) querying Google Routes API, and a realtime inference bridge (`realtime_inference.py`) mapping results to model inputs.
3. **Discrete-Time Survival Analysis**: Replaced the baseline regressor with a survival classifier predicting reopening curves across multiple time horizons, reporting median reopening time and 80% confidence intervals.
4. **Google Routes Feature Contract**: Uses traffic-aware duration, static duration, approach traffic classes, and repeated-poll delay persistence; it does not invent device or queue counts.
5. **Route Comparison**: Interactive UI component (`RouteComparison.tsx`) computing gate-adjusted route ETAs and drawing alternate path risks on the map.
6. **Web Push Alerts**: Service worker caching and notification manager dropdown (`NotificationManager.tsx`) to schedule commute warnings.
7. **Production Analytics**: SQLite/D1 database schema (`db/schema.ts`) and history dashboard (`/dashboard`) showing weekly closure heatmaps.
8. **Multi-District Expansion**: Fetching script expanded to support full-state queries in Jharkhand and Bihar.

## Reproducible Machine Learning Benchmark

The simulator generates 14 distinct crossing profiles (busy urban to quiet rural) with railway closures plus 7 hard-negative congestion scenarios (road accidents, market days, school zones, construction, signal failures, flooding, ordinary jams) and rolling temporal features.

**Evaluation design.** Three full crossings are held out of training entirely and used as an **unseen-crossing test set** — the headline generalization check. The remaining 11 crossings are split chronologically by closure event (70% train / 15% validation / 15% seen-crossing test) so no event straddles train and test. The decision threshold and the UNKNOWN uncertainty band are tuned only on validation data.

**Uncertainty-aware output.** When the closure probability falls inside the tuned band, the model answers `UNKNOWN` (abstains) rather than guessing; stale observations also return `UNKNOWN`. Abstention on ~15–17% of rows raises decided-row accuracy to ~90% on both test sets.

The canonical values are always the generated [evaluation artifact](artifacts/model_evaluation.json), rather than hand-maintained README numbers. It includes seen- and unseen-crossing F1, precision/recall, ROC-AUC, PR-AUC, Brier score, calibration bins, abstention coverage/accuracy, event-level detection delay and missed-closure rate, reopening-time MAE, and per-scenario hard-negative behavior. The [evaluation notebook](notebooks/railcross_model_evaluation.ipynb) presents the same numbers with charts.

## Run Locally

### Setup
1. Copy `.env.example` to `.env.local` and set `GOOGLE_MAPS_API_KEY`.
2. Install dependencies:
   ```bash
   npm install
   ```

### Execution
* Run dev server:
  ```bash
  npm run dev
  ```
* Recreate the synthetic benchmark and replay the serving contract:
  ```bash
  python3 -m ml.simulate_crossings --output data/synthetic/crossing_observations.csv
  python3 -m ml.train_models
  python3 -m ml.replay_inference --limit 200
  python3 -m unittest tests.test_ml_pipeline
  ```
* Run UI tests:
  ```bash
  npm test
  ```
* Poll traffic & run realtime inference:
  ```bash
  python3 -m ml.routes_poller --api-key YOUR_KEY
  python3 -m ml.realtime_inference
  ```
