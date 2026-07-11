# RailCross Field Validation Protocol

## Purpose

Validate the synthetic-trained RailCross model against independently observed crossing events before presenting real-world accuracy or using predictions for route recommendations.

## Data collection

1. Obtain permission from the rail operator, road authority, or CCTV owner before collection.
2. Collect timestamped ground-truth gate state (`OPEN`, `CLOSED`, `UNKNOWN`) at 30-second resolution from authorised CCTV review or trained field observers.
3. Store crossing identifier, observation timestamp, label source, reviewer ID, and an uncertainty flag. Do not retain faces, number plates, or raw video unless expressly authorised and covered by a retention policy.
4. Separately retain Routes API snapshots and crowdsourced reports so that their contribution can be audited.

## Evaluation split

Freeze the evaluation protocol before model tuning. Hold out complete crossings and later calendar dates; never split adjacent observations from the same closure event across train and test. Maintain an untouched final test set.

## Acceptance metrics

Report gate-state precision, recall, F1, PR-AUC, Brier score, reliability diagram, false-closure rate, missed-closure rate, and event detection delay. For reopening estimates report MAE, median error, 80% interval coverage, and error by crossing. Segment every metric by crossing, time of day, weather, and source availability.

## Safety and rollout rules

- Begin in shadow mode: display predictions only to evaluators and record outcomes.
- Never represent a predicted gate state as authoritative signalling information.
- Use a conservative “unknown / verify” state when inputs are stale, disagree, or fall outside training conditions.
- Promote a model only after the frozen test set meets predeclared thresholds and a reviewer signs off on calibration and false-closure behavior.
- Monitor drift, source outages, privacy compliance, and complaint/appeal paths continuously.
