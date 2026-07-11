# RailCross Synthetic Dataset Dictionary

Each row is one 30-second synthetic observation at one crossing during one event.

## Metadata

| Column | Meaning |
|---|---|
| `event_id` | Unique simulated event identifier; used to prevent split leakage. |
| `timestamp_utc` | Synthetic observation timestamp in UTC. |
| `crossing_id` | Synthetic crossing profile identifier. |
| `scenario_kind` | `railway_closure`, `ordinary_congestion`, or `normal_flow`. |
| `ground_truth_source` | Always identifies the synthetic simulator version. |

## Traffic-first model features

| Column | Unit / range | Meaning |
|---|---|---|
| `route_static_duration_seconds` | seconds | Expected route duration without traffic. |
| `route_duration_seconds` | seconds | Synthetic traffic-aware duration. |
| `traffic_delay_seconds` | seconds | Traffic-aware duration minus static duration. |
| `approach_a_speed_kph` | km/h | Noisy aggregate speed on one side of the crossing. |
| `approach_b_speed_kph` | km/h | Noisy aggregate speed on the opposite side. |
| `approach_a_speed_code` | 0, 1, 2 | Normal, slow, or jam traffic class. |
| `approach_b_speed_code` | 0, 1, 2 | Normal, slow, or jam traffic class. |
| `stopped_vehicle_ratio_a` | 0–1 | Estimated fraction stopped or nearly stopped on approach A. |
| `stopped_vehicle_ratio_b` | 0–1 | Estimated fraction stopped or nearly stopped on approach B. |
| `jam_segment_length_meters` | metres | Estimated congested road length. |
| `queue_a_vehicles` | vehicles | Noisy queue estimate on approach A. |
| `queue_b_vehicles` | vehicles | Noisy queue estimate on approach B. |
| `queue_growth_vehicles_per_minute` | vehicles/minute | Change in combined queue size. |
| `congestion_age_minutes` | minutes | Duration of sustained material congestion. |

## Context columns excluded from the main classifier

| Column | Meaning |
|---|---|
| `hour_sin`, `hour_cos` | Cyclic time-of-day representation. |
| `day_of_week`, `is_weekend` | Calendar context. |
| `community_closed_weight` | Synthetic credibility-weighted user reports of closure. |
| `community_open_weight` | Synthetic credibility-weighted user reports of reopening. |
| `community_report_count` | Approximate number of synthetic reports. |
| `train_proximity_signal` | Synthetic train-nearness signal with deliberate false positives. |
| `historical_closure_probability` | Synthetic crossing profile prior. |

## Targets

| Column | Meaning |
|---|---|
| `gate_closed` | Binary classifier target: 1 closed, 0 open. |
| `remaining_closed_seconds` | Regression target; zero when open. |

## Important interpretation rule

The column names resemble possible production features, but the values are simulated. They are not copied from Google Maps and do not reproduce Google’s private traffic dataset.

