# RailCross Traffic-First Gate Prediction — Technical Review

## 1. What the project is trying to solve

RailCross is a Google Maps-based prototype that warns travellers about railway level crossings that may be closed. The product idea is to detect an approaching gate closure from aggregate vehicle behaviour near the crossing, then eventually use that result when comparing routes.

The present implementation contains:

- the official Google Maps JavaScript map;
- Google-powered origin and destination autocomplete fields;
- 528 OpenStreetMap `railway=level_crossing` points across Latehar, Ranchi, and East Singhbhum districts;
- a toggle that shows or hides the crossing layer;
- a traffic-first classifier that predicts `OPEN` or `CLOSED`;
- a regression model that estimates remaining closure time;
- map popups that explain each synthetic prediction using speeds and queue evidence.

The present implementation does **not** contain live Google vehicle traces, verified live railway gate states, live train telemetry, or real-world model accuracy.

## 2. How the model predicts gate state

Every observation represents one 30-second snapshot near a crossing. The classifier receives a fixed 14-value feature vector:

1. normal route duration without traffic;
2. observed traffic-aware route duration;
3. traffic delay;
4. approach A vehicle speed;
5. approach B vehicle speed;
6. approach A speed class: normal, slow, or jam;
7. approach B speed class;
8. stopped-vehicle ratio on approach A;
9. stopped-vehicle ratio on approach B;
10. estimated jam length;
11. queued vehicles on approach A;
12. queued vehicles on approach B;
13. queue growth per minute;
14. how long congestion has persisted.

The trained histogram gradient-boosting classifier converts those values into a probability that the gate is closed. The validation-selected decision threshold is 0.75:

- probability below 0.75 → `OPEN`;
- probability at or above 0.75 → `CLOSED`.

When the classifier predicts `CLOSED`, a separate histogram gradient-boosting regressor estimates how many seconds remain before reopening.

Community votes, train proximity, historical closure probability, hour, and day are generated as contextual columns but are deliberately excluded from the main traffic-first classifier. This keeps the resume claim aligned with the stated USP: prediction from vehicle movement and queues.

## 3. How the synthetic dataset was generated

The simulator creates 650 independent traffic events. Each event lasts 46 time steps, and every step represents 30 seconds. This produces 29,900 rows, or about 23 minutes per event.

Three types of event are generated:

- `railway_closure`: the gate closes for a randomly selected interval;
- `ordinary_congestion`: traffic slows without a railway closure;
- `normal_flow`: no gate closure and no sustained ordinary jam.

The ordinary-congestion events are important negative examples. Without them, a classifier could simply learn that “traffic means closed,” which would not solve the real problem.

### 3.1 Vehicle arrivals and queues

At every step, vehicles arrive independently on both approaches. Arrival volume changes with a synthetic morning/evening rush-hour multiplier.

- During a gate closure, queues grow on both approaches.
- After reopening, both queues drain gradually instead of disappearing instantly.
- During ordinary congestion, the simulator often slows only one approach or uses weaker bilateral growth.
- During normal flow, queues fluctuate near a small baseline.

Queue observations include measurement noise so the model does not receive a perfectly clean hidden state.

### 3.2 Vehicle speeds and stopped ratios

The simulator starts each crossing with a free-flow speed profile. Speed falls exponentially as the queue increases, then receives random measurement noise. The resulting speed is translated into normal, slow, or jam classes.

Stopped-vehicle ratio is generated from the relative speed reduction plus noise. It approximates the share of observed vehicles moving very slowly or not moving. These are aggregate features; the project is not designed to track individual vehicles.

### 3.3 Delay, jam length, and congestion age

Jam length is estimated from the noisy total queue. Traffic delay is generated from total queued vehicles, an additional ordinary-jam penalty, and noise. Congestion age increases while delay remains material and decays when traffic recovers.

### 3.4 Labels

`gate_closed` is the simulator’s ground-truth classification label. `remaining_closed_seconds` is positive only while the simulated gate is closed. The final row-level closed rate is 24.34%, even though a larger share of whole events contain a closure, because each event also contains open periods before and after closure.

## 4. Training and validation design

The rows are grouped by event. Events—not individual rows—are assigned chronologically:

- first 70% of events: training;
- next 15%: threshold validation;
- final 15%: testing.

There is zero event-ID overlap between training and test. This prevents snapshots from one simulated event appearing in both training and testing.

The classifier uses class weights to reduce bias toward the more frequent open state. The validation set searches thresholds from 0.20 to 0.80 and maximizes `F1 - 0.25 × false-positive rate`. The final threshold is 0.75.

The reopening-time regressor is trained only on closed training rows and uses absolute-error loss.

## 5. Verified synthetic results

### Classification

| Metric | Traffic-first model | Simple baseline rule |
|---|---:|---:|
| Accuracy | 0.9594 | 0.8088 |
| Precision | 0.9352 | 0.6293 |
| Recall | 0.8858 | 0.4203 |
| F1 | 0.9098 | 0.5040 |
| False-positive rate | 0.0185 | 0.0744 |
| ROC AUC | 0.9885 | Not calculated |

Confusion matrix on held-out synthetic rows, ordered as `[OPEN, CLOSED]`:

```text
[[3402, 64],
 [ 119, 923]]
```

Event-level synthetic detection:

- closure events in the test set: 66;
- missed-event rate: 0%;
- median detection delay: 30 seconds;
- 90th-percentile detection delay: 60 seconds.

### Reopening-time prediction

- mean absolute error: 1.766 minutes;
- median absolute error: 1.643 minutes;
- predictions within two minutes: 60.36%.

### Sanity check on the 528 exported map snapshots

| Predicted state | Count | Mean approach speed | Mean total queue | Mean stopped ratio |
|---|---:|---:|---:|---:|
| OPEN | 388 | 28.29 km/h | 11.12 vehicles | 0.145 |
| CLOSED | 140 | 16.15 km/h | 34.62 vehicles | 0.446 |

This direction is sensible, but it is not independent validation: both the snapshots and model originate from the same simulator family.

## 6. What the model learned

Permutation importance measures how much held-out F1 falls when one feature is shuffled. The strongest features are:

| Rank | Feature | F1 decrease |
|---:|---|---:|
| 1 | Queue growth per minute | 0.28316 |
| 2 | Congestion age | 0.09191 |
| 3 | Queue B vehicles | 0.06155 |
| 4 | Stopped ratio B | 0.05761 |
| 5 | Approach B speed | 0.05667 |
| 6 | Approach A speed | 0.05580 |
| 7 | Stopped ratio A | 0.02318 |
| 8 | Queue A vehicles | 0.01611 |

The intended interpretation is that railway closures create persistent bilateral queue growth and stopped traffic. An ordinary jam may be slow but often lacks the same two-sided growth pattern.

## 7. Map integration

The crossing coordinates come from OpenStreetMap, not Google. The official Google map displays those external coordinates through a Google Maps data layer.

The public prediction export assigns one deterministic synthetic traffic snapshot to each of the 528 crossings and scores it using the trained model:

- green point: model predicts `OPEN`;
- red point: model predicts `CLOSED`;
- click popup: closure probability, both approach speeds, movement labels, queues, queue growth, and estimated reopening time.

Every popup explicitly states that it is a synthetic demonstration and not a live or verified state.

## 8. Validation assessment

**Overall assessment: Share with caveats.**

The code pipeline, event split, metric recomputation, and UI integration are reproducible. The project is appropriate as a model-first prototype and resume demonstration if every performance number is labelled synthetic.

It is not ready for a claim such as “90.98% accurate on real railway crossings.” The simulator encodes the relationship that the model later learns, so synthetic performance is expected to be optimistic.

### Material risks

1. **Simulator-to-model circularity:** the same assumptions generate training and testing events.
2. **Domain gap:** actual traffic can stop for intersections, markets, accidents, construction, signals, schools, or weather.
3. **Sensor feasibility:** Google Maps does not provide raw per-crossing speed, stopped-ratio, or queue observations through the current project.
4. **Ground-truth gap:** no independently verified gate state has been collected.
5. **Crossing coverage:** OpenStreetMap may omit crossings or contain stale attributes.
6. **Probability calibration:** a synthetic probability should not be interpreted as a real-world frequency.
7. **Repeated observations:** row-level metrics are not a substitute for event- and crossing-level performance.

## 9. Recommended real-world validation plan

1. Select 5–10 crossings with safe observation points.
2. Record timestamped gate state using manual observation, authorised CCTV analysis, or an official railway feed.
3. Compute privacy-preserving aggregate traffic features for fixed road segments on both approaches.
4. Freeze the synthetic model before evaluating real events.
5. Use crossing-held-out validation so one crossing’s behaviour cannot leak into its test data.
6. Report event-level precision, recall, false alarms per day, detection delay, and reopening MAE.
7. Retrain only after publishing the frozen-model baseline.

## 10. Reproducibility commands

From the project root:

```bash
python3 -m ml.simulate_crossings --output data/synthetic/crossing_observations.csv --events 650 --seed 42
python3 -m ml.train_models --dataset data/synthetic/crossing_observations.csv --model-dir models --artifact-dir artifacts
python3 -m ml.export_pilot_predictions
npm run build
```

## 11. Suggested reviewer focus

- Check whether ordinary congestion is difficult and varied enough.
- Look for features that are too close to the label-generating rules.
- Review whether the reopening target should use survival analysis or censored regression.
- Review probability calibration, threshold selection, and event-level scoring.
- Propose a practical and ethical way to obtain aggregate traffic observations and verified gate labels.

