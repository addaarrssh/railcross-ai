"""Compute Bayesian prior probability of railway crossing closure from train schedules."""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, time
from pathlib import Path


def get_schedule_prior(
    crossing_id: str, 
    dt: datetime, 
    schedule_path: Path = Path("data/schedules/jharkhand_train_schedule.json")
) -> float:
    if not schedule_path.exists():
        return 0.08  # Default baseline prior

    try:
        schedule_data = json.loads(schedule_path.read_text(encoding="utf-8"))
    except Exception:
        return 0.08

    schedules = schedule_data.get("schedules", [])
    crossing_schedule = None
    for item in schedules:
        if item["crossing_id"] == crossing_id:
            crossing_schedule = item
            break

    if not crossing_schedule:
        return 0.08

    trains = crossing_schedule.get("trains", [])
    day_of_week = dt.weekday()  # Monday=0, Sunday=6
    
    total_prior_contribution = 0.0
    
    for train in trains:
        if day_of_week not in train["days"]:
            continue
            
        # Parse expected arrival time
        expected_str = train["expected_time"] # "HH:MM"
        try:
            exp_h, exp_m = map(int, expected_str.split(":"))
            # Compute time delta in minutes
            dt_expected = dt.replace(hour=exp_h, minute=exp_m, second=0, microsecond=0)
            delta_seconds = (dt_expected - dt).total_seconds()
            
            # We care about trains approaching (i.e. expected time is in the future)
            # and recently passed trains (expected time was up to 10 minutes ago, i.e., gate is still draining)
            delta_minutes = delta_seconds / 60.0
            
            # Gaussian window with sigma = 5 minutes centered around the arrival window
            # If train is within -5 to +15 minutes, we add to prior
            sigma = 5.0
            # Center of closure window is usually slightly before arrival
            center = 3.0  # gate closes ~3 mins before train
            diff = delta_minutes - center
            
            contribution = math.exp(-(diff**2) / (2 * (sigma**2)))
            total_prior_contribution += contribution
        except Exception:
            continue

    # Baseline probability of gate closure is 0.08, capped at 0.95
    prior = 0.08 + (0.87 * min(1.0, total_prior_contribution))
    return float(prior)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crossing-id", type=str, default="JAM-ADX-01")
    parser.add_argument("--time", type=str, help="ISO 8601 datetime string, e.g. 2026-07-11T08:18:00")
    parser.add_argument("--schedule", type=Path, default=Path("data/schedules/jharkhand_train_schedule.json"))
    args = parser.parse_args()

    if args.time:
        dt = datetime.fromisoformat(args.time)
    else:
        dt = datetime.now()

    prior = get_schedule_prior(args.crossing_id, dt, args.schedule)
    print(f"Crossing: {args.crossing_id}")
    print(f"Time: {dt.isoformat()}")
    print(f"Calculated Prior Probability: {prior:.4f}")


if __name__ == "__main__":
    main()
