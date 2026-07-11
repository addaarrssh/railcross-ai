"""Replay labelled synthetic observations through the saved RailCross model.

This is a portfolio-safe integration mode: it exercises the same feature and
inference contract as a live poller without claiming that synthetic traffic is
live traffic. It writes a compact JSONL audit trail for inspection in the UI,
not a production accuracy claim.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from ml.inference import RailCrossPredictor
from ml.simulate_crossings import FEATURE_COLUMNS


def replay(dataset_path: Path, model_dir: Path, output_path: Path, limit: int = 200) -> int:
    predictor = RailCrossPredictor(model_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with dataset_path.open(newline="", encoding="utf-8") as source, output_path.open("w", encoding="utf-8") as target:
        for row in csv.DictReader(source):
            if written >= limit:
                break
            features = {column: float(row[column]) for column in FEATURE_COLUMNS}
            prediction = predictor.predict(features)
            record = {
                "mode": "synthetic_replay",
                "event_id": int(row["event_id"]),
                "crossing_id": row["crossing_id"],
                "timestamp_utc": row["timestamp_utc"],
                "scenario_kind": row["scenario_kind"],
                "synthetic_ground_truth_gate_closed": int(row["gate_closed"]),
                "prediction": prediction,
            }
            target.write(json.dumps(record) + "\n")
            written += 1
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("data/synthetic/crossing_observations.csv"))
    parser.add_argument("--model-dir", type=Path, default=Path("models"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/synthetic_replay.jsonl"))
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()
    print(f"Wrote {replay(args.dataset, args.model_dir, args.output, args.limit)} synthetic replay records to {args.output}")


if __name__ == "__main__":
    main()
