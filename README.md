# RailCross

RailCross is a railway-crossing-aware navigation concept. It makes the delay
behind a red traffic segment explainable: is the railway gate likely closed,
when will the queue clear, and is a detour worth it?

The project's main USP is its prediction engine. It classifies a crossing as
open or closed and estimates remaining closure time using Google-Routes-like
traffic signals, queue behavior, historical patterns, and reputation-weighted
community reports.

## Final product boundary

The main product is intentionally narrow:

1. Display an actual Google Map.
2. Overlay railway-crossing coordinates sourced from OpenStreetMap and verified
   before production use.
3. Run the RailCross model for a selected crossing.
4. Show `OPEN` or `CLOSED`, closure probability, and estimated reopening time
   when the marker is clicked or hovered.

Nearby-user confirmation is a proposed future data source. It is displayed as
a roadmap idea and is not represented as an implemented or validated feature.

Google Places does not currently expose a dedicated level-crossing place type,
so the pilot marker layer uses deduplicated OpenStreetMap
`railway=level_crossing` nodes on top of Google Maps.

## What this prototype demonstrates

- A map-first route-planning interface with a Google Maps-like interaction model
- An arrival-risk score: the chance a crossing will delay a traveller when they reach it
- A route decision that adds predicted crossing delay to travel time
- Signal fusion across traffic patterns, community reports, and historical behavior
- Community confirmation controls with a reputation-aware explanation
- Three replayable scenarios: gate closed, queue reopening, and clear flow

The displayed signals are a clearly labelled local demo. They are not live
railway or Google traffic data.

## Model pipeline

```bash
python -m ml.simulate_crossings
python -m ml.train_models
python -m ml.export_map_demo
python -m ml.build_notebook
```

The synthetic schema mirrors public traffic-aware route concepts such as
static duration, traffic-aware duration, and `NORMAL`/`SLOW`/`TRAFFIC_JAM`
segments. It does not reproduce or claim access to Google's internal data.

## Actual Google Maps setup

1. Create a Google Cloud API key.
2. Enable the Maps JavaScript API.
3. Restrict the key to the website domain and the Maps JavaScript API.
4. Copy `.env.example` to `.env.local` and set `GOOGLE_MAPS_API_KEY`.
5. Run `npm run dev`.

The committed source contains no Google credential. Without a key, the app
shows a setup screen while preserving the already-published version.

Artifacts:

- `data/synthetic/crossing_observations.csv` — reproducible event observations
- `models/status_classifier.joblib` — open/closed classifier
- `models/reopening_regressor.joblib` — remaining-time predictor
- `artifacts/model_evaluation.json` — machine-readable evaluation
- `notebooks/railcross_model_evaluation.ipynb` — executed analysis notebook

### Current reproducible benchmark

Using a chronological holdout of complete synthetic events:

- Open/closed classifier: **0.944 F1**, **0.949 precision**, and **0.939 recall**
- False-positive rate: **1.53%**, compared with **7.95%** for the rule baseline
- Remaining-closure predictor: **1.68 minutes MAE**
- Data checks: **29,900 rows**, **650 events**, no duplicate event/timestamp keys, and no missing model features

These numbers must always be described as synthetic benchmarks. Real-world
accuracy will be reported separately after collecting independently labelled
gate events.

### Honest resume bullets

- Designed a deterministic railway-crossing simulator that generated 29,900
  timestamped observations across 650 events using traffic-aware duration,
  segment congestion, queue dynamics, and noisy crowd reports.
- Trained a gradient-boosted open/closed classifier that achieved 0.944 F1 on
  a chronological synthetic-event holdout, outperforming a transparent
  traffic-delay baseline while reducing false positives from 7.95% to 1.53%.
- Built a remaining-closure regression model with 1.68-minute synthetic MAE
  and packaged the complete evaluation in an executable Jupyter notebook.

### Tools demonstrated

Python, NumPy, scikit-learn, gradient boosting, joblib, Jupyter, model
evaluation, synthetic data generation, event-based validation, JavaScript,
React, and deployment.

## Production data plan

1. Register verified crossing coordinates from OpenStreetMap and field checks.
2. Log ground-truth gate events through an admin, camera, or sensor workflow.
3. Request Google traffic-aware route measurements with controlled quotas.
4. Train a closure classifier and remaining-wait regressor against labelled events.
5. Store reports, voting reputation, crossing events, and model output in D1 or PostgreSQL.

## Run locally

```bash
npm install
npm run dev
```

## Resume-ready project statement

> Built RailCross, a railway-crossing-aware navigation prototype that fuses traffic patterns, crowd verification, and arrival-risk prediction to recommend whether travellers should wait or reroute.
