# RailCross — ML Systems Prototype

RailCross is a railway-crossing-aware navigation system that combines machine learning, train schedules, crowdsourced reports, and traffic queries. It predicts whether a level crossing gate is OPEN or CLOSED, estimates remaining closure time using discrete-time survival analysis, and recommends risk-aware commute routing.

## Live Demo

Visit the deployed application: [railcross-ai.adarshprivate678.workers.dev](https://railcross-ai.adarshprivate678.workers.dev)

**Current evidence is synthetic only.** The model is trained and tested on a reproducible event-driven simulator, not real gate telemetry. See [ML project documentation](docs/ML_PROJECT.md) and the [field-validation protocol](docs/PILOT_VALIDATION_PROTOCOL.md) before making any operational or accuracy claim.

## Key Features Built & Implemented

1. **Crowdsourced Verification**: Live API endpoint (`/api/reports`) for users to report gate state with geofenced GPS verification (max 500m proximity).
2. **Real-time Traffic Pipeline**: Standalone poller (`routes_poller.py`) querying Google Routes API, and a realtime inference bridge (`realtime_inference.py`) mapping results to model inputs.
3. **Discrete-Time Survival Analysis**: Replaced the baseline regressor with a survival classifier predicting reopening curves across multiple time horizons, reporting median reopening time and 80% confidence intervals.
4. **Bayesian Prior Adjustments**: Integrates train schedule data (`jharkhand_train_schedule.json`) with a Gaussian window prior calculator (`schedule_prior.py`) to refine prediction certainty.
5. **Route Comparison**: Interactive UI component (`RouteComparison.tsx`) computing gate-adjusted route ETAs and drawing alternate path risks on the map.
6. **Web Push Alerts**: Service worker caching and notification manager dropdown (`NotificationManager.tsx`) to schedule commute warnings.
7. **Production Analytics**: SQLite/D1 database schema (`db/schema.ts`) and history dashboard (`/dashboard`) showing weekly closure heatmaps.
8. **Multi-District Expansion**: Fetching script expanded to support full-state queries in Jharkhand and Bihar.

## Reproducible Machine Learning Benchmark

The models were retrained against a hardened simulation dataset incorporating 6 new hard negative scenario types (e.g. road accidents, school zones, construction jams) and 6 rolling temporal features:

The canonical values are always the generated [evaluation artifact](artifacts/model_evaluation.json), rather than hand-maintained README numbers. It includes F1, precision/recall, ROC-AUC, PR-AUC, Brier score, calibration bins, event detection, and performance against hard-negative scenarios.

### Reopening Survival Classifier
* **Mean Absolute Error (MAE)**: **1.73 minutes**
* **Median Absolute Error**: **1.53 minutes**
* **Calibration Error (180s)**: **0.0023** (very highly calibrated survival curve)

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
