"""Generate labelled traffic observations matching the Google Routes feature contract.

The simulator uses hidden traffic dynamics to generate labels, but exports only
traffic-aware duration, static duration, speed classes, and time-history fields
that a Routes API polling service can obtain or calculate. It does not claim
access to Google's private device or vehicle data.
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np


FEATURE_COLUMNS = [
    "route_static_duration_seconds",
    "route_duration_seconds",
    "traffic_delay_seconds",
    "approach_a_speed_code",
    "approach_b_speed_code",
    "both_approaches_jammed",
    "traffic_delay_change_1min_seconds",
    "both_approaches_jammed_minutes",
    "traffic_delay_rolling_3min_seconds",
    "traffic_delay_rolling_10min_seconds",
]

CONTEXT_COLUMNS: list[str] = []

METADATA_COLUMNS = [
    "event_id",
    "timestamp_utc",
    "crossing_id",
    "scenario_kind",
    "ground_truth_source",
]

TARGET_COLUMNS = ["gate_closed", "remaining_closed_seconds"]
ALL_COLUMNS = METADATA_COLUMNS + FEATURE_COLUMNS + CONTEXT_COLUMNS + TARGET_COLUMNS


@dataclass(frozen=True)
class SimulationConfig:
    events: int = 650
    steps_per_event: int = 46
    step_seconds: int = 30
    closure_probability: float = 0.50
    seed: int = 42


def _speed_code(speed_kph: float, free_flow_kph: float) -> int:
    """Encode Google-Routes-like traffic classes: 0=NORMAL, 1=SLOW, 2=JAM."""
    ratio = speed_kph / max(free_flow_kph, 1.0)
    if ratio < 0.32:
        return 2
    if ratio < 0.68:
        return 1
    return 0


def _rush_multiplier(hour: float) -> float:
    morning = math.exp(-((hour - 8.5) ** 2) / 4.0)
    evening = math.exp(-((hour - 18.0) ** 2) / 5.0)
    return 0.85 + 0.55 * max(morning, evening)


def generate_rows(config: SimulationConfig) -> list[dict[str, object]]:
    rng = np.random.default_rng(config.seed)
    rows: list[dict[str, object]] = []
    base_time = datetime(2026, 1, 1, 5, 30, tzinfo=timezone.utc)
    crossing_profiles = [
        ("JAM-ADX-01", 0.72, 35.0, 155.0),
        ("JAM-GAM-02", 0.61, 31.0, 142.0),
        ("JAM-KND-03", 0.56, 38.0, 168.0),
    ]

    for event_id in range(config.events):
        crossing_id, historical_probability, free_flow_kph, base_duration = crossing_profiles[event_id % len(crossing_profiles)]
        event_start = base_time + timedelta(minutes=37 * event_id)
        hour = event_start.hour + event_start.minute / 60
        volume_multiplier = _rush_multiplier(hour)
        
        has_closure = bool(rng.random() < config.closure_probability)
        
        # Scenario distribution
        if has_closure:
            scenario_kind = "railway_closure"
        else:
            kinds = [
                "ordinary_congestion", 
                "road_accident", 
                "market_day", 
                "construction_zone", 
                "school_zone", 
                "signal_failure", 
                "weather_flooding"
            ]
            probs = [0.25, 0.15, 0.12, 0.12, 0.12, 0.12, 0.12]
            scenario_kind = str(rng.choice(kinds, p=probs))

        scenario_start = int(rng.integers(5, 11))
        
        if scenario_kind == "railway_closure":
            scenario_steps = int(rng.integers(9, 25))
        elif scenario_kind == "ordinary_congestion":
            scenario_steps = int(rng.integers(7, 19))
        elif scenario_kind == "road_accident":
            scenario_steps = int(rng.integers(16, 41)) # 8-20 mins
        elif scenario_kind == "market_day":
            scenario_steps = int(rng.integers(30, 61)) # 15-30 mins
        elif scenario_kind == "construction_zone":
            scenario_steps = int(rng.integers(20, 51)) # 10-25 mins
        elif scenario_kind == "school_zone":
            scenario_steps = 30 # 15 mins
        elif scenario_kind == "signal_failure":
            scenario_steps = int(rng.integers(16, 31)) # 8-15 mins
        elif scenario_kind == "weather_flooding":
            scenario_steps = int(rng.integers(40, 81)) # 20-40 mins
        else:
            scenario_steps = 0

        scenario_end = min(scenario_start + scenario_steps, config.steps_per_event - 2)
        ordinary_jam_side = int(rng.choice([0, 1, 2], p=[0.35, 0.35, 0.30]))
        false_train_signal = bool((scenario_kind != "railway_closure") and rng.random() < 0.38)
        false_train_center = int(rng.integers(5, config.steps_per_event - 5))

        preexisting_congestion = bool(rng.random() < 0.20)
        queue_a = float(max(0, rng.normal(9.0 if preexisting_congestion else 1.5, 3.0 if preexisting_congestion else 0.8)))
        queue_b = float(max(0, rng.normal(7.5 if preexisting_congestion else 1.2, 2.8 if preexisting_congestion else 0.7)))
        previous_total_queue = queue_a + queue_b
        congestion_age = 0.0
        closed_report_weight = 0.0
        open_report_weight = 0.0

        # Temporal history queues
        history_speed_a: list[float] = []
        history_speed_b: list[float] = []
        history_queue_growth: list[float] = []
        history_combined_speed: list[float] = []
        history_traffic_delay: list[float] = []
        both_approaches_jammed_minutes = 0.0

        for step in range(config.steps_per_event):
            timestamp = event_start + timedelta(seconds=step * config.step_seconds)
            in_scenario = (scenario_start <= step < scenario_end)
            gate_closed = int(scenario_kind == "railway_closure" and in_scenario)
            gate_just_opened = bool(scenario_kind == "railway_closure" and step >= scenario_end)
            arrivals_a = max(0.5, rng.normal(3.1 * volume_multiplier, 0.65))
            arrivals_b = max(0.4, rng.normal(2.7 * volume_multiplier, 0.6))

            if gate_closed:
                queue_a += arrivals_a * 0.5
                queue_b += arrivals_b * 0.5
            elif gate_just_opened and queue_a + queue_b > 2:
                queue_a = max(0.0, queue_a - max(1.4, rng.normal(4.9, 0.65)) * 0.5)
                queue_b = max(0.0, queue_b - max(1.2, rng.normal(4.4, 0.6)) * 0.5)
            elif scenario_kind == "ordinary_congestion" and in_scenario:
                if ordinary_jam_side == 0:
                    queue_a += arrivals_a * 0.33
                    queue_b = max(0.0, queue_b - 0.6)
                elif ordinary_jam_side == 1:
                    queue_b += arrivals_b * 0.33
                    queue_a = max(0.0, queue_a - 0.6)
                else:
                    queue_a += arrivals_a * 0.31
                    queue_b += arrivals_b * 0.30
            elif scenario_kind == "road_accident" and in_scenario:
                mult = float(rng.uniform(0.40, 0.45))
                queue_a += arrivals_a * mult
                queue_b += arrivals_b * mult
            elif scenario_kind == "market_day" and in_scenario:
                mult = float(rng.uniform(0.25, 0.30))
                queue_a += arrivals_a * mult
                queue_b += arrivals_b * mult
            elif scenario_kind == "construction_zone" and in_scenario:
                queue_a += arrivals_a * 0.38
                queue_b += arrivals_b * 0.20
            elif scenario_kind == "school_zone" and in_scenario:
                queue_a += arrivals_a * 0.28
                queue_b += arrivals_b * 0.28
            elif scenario_kind == "signal_failure" and in_scenario:
                if step % 4 == 0:
                    queue_a = max(0.0, queue_a - 1.0)
                    queue_b = max(0.0, queue_b - 1.0)
                else:
                    queue_a += arrivals_a * 0.35
                    queue_b += arrivals_b * 0.25
            elif scenario_kind == "weather_flooding" and in_scenario:
                queue_a += arrivals_a * 0.15
                queue_b += arrivals_b * 0.15
            else:
                queue_a = max(0.0, queue_a + rng.normal(-0.25, 0.45))
                queue_b = max(0.0, queue_b + rng.normal(-0.2, 0.4))

            queue_a = float(min(queue_a, 92.0))
            queue_b = float(min(queue_b, 92.0))
            total_queue = queue_a + queue_b
            queue_growth = (total_queue - previous_total_queue) / (config.step_seconds / 60)
            previous_total_queue = total_queue

            speed_a = free_flow_kph * math.exp(-queue_a / 19.0) + rng.normal(0, 1.7)
            speed_b = free_flow_kph * math.exp(-queue_b / 19.0) + rng.normal(0, 1.7)

            if scenario_kind == "weather_flooding" and in_scenario:
                speed_a *= float(rng.uniform(0.3, 0.5))
                speed_b *= float(rng.uniform(0.3, 0.5))
            elif scenario_kind == "road_accident" and in_scenario:
                speed_a *= 0.4
                speed_b *= 0.4

            speed_a = float(np.clip(speed_a, 1.5, free_flow_kph + 4))
            speed_b = float(np.clip(speed_b, 1.5, free_flow_kph + 4))
            observed_speed_a = float(np.clip(speed_a + rng.normal(0, 1.2), 0, free_flow_kph + 6))
            observed_speed_b = float(np.clip(speed_b + rng.normal(0, 1.2), 0, free_flow_kph + 6))
            stopped_ratio_a = float(np.clip(max(0.0, 1 - observed_speed_a / free_flow_kph) ** 1.35 + rng.normal(0, 0.045), 0, 1))
            stopped_ratio_b = float(np.clip(max(0.0, 1 - observed_speed_b / free_flow_kph) ** 1.35 + rng.normal(0, 0.045), 0, 1))
            speed_code_a = _speed_code(speed_a, free_flow_kph)
            speed_code_b = _speed_code(speed_b, free_flow_kph)
            if rng.random() < 0.08:
                speed_code_a = int(np.clip(speed_code_a + rng.choice([-1, 1]), 0, 2))
            if rng.random() < 0.08:
                speed_code_b = int(np.clip(speed_code_b + rng.choice([-1, 1]), 0, 2))

            observed_queue_a = max(0.0, queue_a + rng.normal(0, 2.4))
            observed_queue_b = max(0.0, queue_b + rng.normal(0, 2.4))
            observed_total_queue = observed_queue_a + observed_queue_b
            observed_queue_growth = queue_growth + rng.normal(0, 3.4)
            jam_length = max(0.0, observed_total_queue * rng.normal(6.15, 1.15))
            static_duration = max(90.0, rng.normal(base_duration, 4.0))
            
            is_ordinary_or_similar = scenario_kind in ["ordinary_congestion", "road_accident", "market_day", "construction_zone", "school_zone", "signal_failure"]
            asymmetric_penalty = 12.0 if (is_ordinary_or_similar and in_scenario) else 0.0
            traffic_delay = max(0.0, observed_total_queue * 4.05 + asymmetric_penalty + rng.normal(0, 22.0))
            route_duration = static_duration + traffic_delay
            if traffic_delay > 45:
                congestion_age += config.step_seconds / 60
            else:
                congestion_age = max(0.0, congestion_age - 1.0)

            both_approaches_jammed = int(speed_code_a == 2 and speed_code_b == 2)
            if both_approaches_jammed:
                both_approaches_jammed_minutes += config.step_seconds / 60
            else:
                both_approaches_jammed_minutes = 0.0
            history_traffic_delay.append(traffic_delay)
            traffic_delay_change_1min = (
                traffic_delay - history_traffic_delay[-3]
                if len(history_traffic_delay) >= 3
                else 0.0
            )
            traffic_delay_rolling_3min = float(np.mean(history_traffic_delay[-6:]))
            traffic_delay_rolling_10min = float(np.mean(history_traffic_delay[-20:]))

            if scenario_kind == "railway_closure":
                proximity = max(0.0, 1.0 - abs(step - scenario_start) / 8.0)
                if step > scenario_start:
                    proximity = max(proximity, max(0.0, 0.75 - (step - scenario_start) / 42.0))
            elif false_train_signal:
                proximity = max(0.0, 0.9 - abs(step - false_train_center) / 10.0)
            else:
                proximity = max(0.0, rng.normal(0.08, 0.07))
            proximity = float(np.clip(proximity + rng.normal(0, 0.16), 0, 1))

            closed_report_weight *= 0.90
            open_report_weight *= 0.88
            report_delay = int(rng.integers(2, 6))
            if gate_closed and step >= scenario_start + report_delay and rng.random() < 0.52:
                closed_report_weight += max(0.0, rng.normal(0.72, 0.24))
            if is_ordinary_or_similar and in_scenario and rng.random() < 0.30:
                closed_report_weight += max(0.0, rng.normal(0.48, 0.22))
            if (not gate_closed) and rng.random() < 0.055:
                closed_report_weight += max(0.0, rng.normal(0.34, 0.16))
            if gate_just_opened and rng.random() < 0.46:
                open_report_weight += max(0.0, rng.normal(0.66, 0.22))
            if gate_closed and rng.random() < 0.08:
                open_report_weight += max(0.0, rng.normal(0.28, 0.14))
            closed_weight = max(0.0, closed_report_weight + rng.normal(0, 0.12))
            open_weight = max(0.0, open_report_weight + rng.normal(0, 0.12))
            report_count = int(round(max(0.0, closed_weight + open_weight + rng.normal(0, 0.8))))

            # Store in histories
            history_speed_a.append(observed_speed_a)
            history_speed_b.append(observed_speed_b)
            history_queue_growth.append(observed_queue_growth)
            history_combined_speed.append((observed_speed_a + observed_speed_b) / 2.0)

            # Compute rolling features
            speed_a_roll = float(np.mean(history_speed_a[-6:]))
            speed_b_roll = float(np.mean(history_speed_b[-6:]))
            qg_roll_3m = float(np.mean(history_queue_growth[-6:]))
            qg_roll_10m = float(np.mean(history_queue_growth[-20:]))
            q_accel = float(observed_queue_growth - (history_queue_growth[-7] if len(history_queue_growth) >= 7 else observed_queue_growth))
            
            y_speed = history_combined_speed[-10:]
            N_speed = len(y_speed)
            if N_speed > 1:
                x_speed = np.arange(N_speed)
                speed_trend = float(np.polyfit(x_speed, y_speed, 1)[0])
            else:
                speed_trend = 0.0

            current_hour = timestamp.hour + timestamp.minute / 60
            remaining_seconds = max(0, (scenario_end - step) * config.step_seconds) if gate_closed else 0
            
            row: dict[str, object] = {
                "event_id": event_id,
                "timestamp_utc": timestamp.isoformat(),
                "crossing_id": crossing_id,
                "scenario_kind": scenario_kind,
                "ground_truth_source": "synthetic_simulator_v2",
                "hour_sin": math.sin(2 * math.pi * current_hour / 24),
                "hour_cos": math.cos(2 * math.pi * current_hour / 24),
                "day_of_week": timestamp.weekday(),
                "is_weekend": int(timestamp.weekday() >= 5),
                "route_static_duration_seconds": static_duration,
                "route_duration_seconds": route_duration,
                "traffic_delay_seconds": traffic_delay,
                "approach_a_speed_code": speed_code_a,
                "approach_b_speed_code": speed_code_b,
                "both_approaches_jammed": both_approaches_jammed,
                "traffic_delay_change_1min_seconds": traffic_delay_change_1min,
                "both_approaches_jammed_minutes": both_approaches_jammed_minutes,
                "traffic_delay_rolling_3min_seconds": traffic_delay_rolling_3min,
                "traffic_delay_rolling_10min_seconds": traffic_delay_rolling_10min,
                "community_closed_weight": closed_weight,
                "community_open_weight": open_weight,
                "community_report_count": report_count,
                "train_proximity_signal": proximity,
                "historical_closure_probability": historical_probability,
                "gate_closed": gate_closed,
                "remaining_closed_seconds": remaining_seconds,
            }
            rows.append(row)

    return rows


def write_dataset(path: Path, config: SimulationConfig) -> dict[str, int]:
    rows = generate_rows(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=ALL_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    closed_rows = sum(int(row["gate_closed"]) for row in rows)
    return {"rows": len(rows), "events": config.events, "closed_rows": closed_rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/synthetic/crossing_observations.csv"))
    parser.add_argument("--events", type=int, default=SimulationConfig.events)
    parser.add_argument("--seed", type=int, default=SimulationConfig.seed)
    args = parser.parse_args()
    summary = write_dataset(args.output, SimulationConfig(events=args.events, seed=args.seed))
    print(f"Wrote {summary['rows']:,} rows across {summary['events']} events to {args.output}")
    print(f"Closed-state rows: {summary['closed_rows']:,}")


if __name__ == "__main__":
    main()
