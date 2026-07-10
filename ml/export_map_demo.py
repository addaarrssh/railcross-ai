"""Export crossing markers with predictions produced by the trained model.

The exported predictions intentionally use synthetic feature snapshots. They
demonstrate the model-to-map integration and are not live gate observations.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from ml.inference import RailCrossPredictor
from ml.simulate_crossings import FEATURE_COLUMNS, SimulationConfig, generate_rows


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / "data" / "crossings" / "jamshedpur_crossings.json"
OUTPUT_PATH = ROOT / "public" / "crossings.json"


def export() -> Path:
    crossing_data = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    synthetic_rows = generate_rows(SimulationConfig(events=80, seed=2026))
    by_event: dict[int, list[dict[str, object]]] = defaultdict(list)
    for row in synthetic_rows:
        by_event[int(row["event_id"])].append(row)

    closed_examples = [
        row
        for event_rows in by_event.values()
        for row in event_rows
        if int(row["gate_closed"]) == 1 and 180 <= float(row["remaining_closed_seconds"]) <= 540
    ]
    open_examples = [
        row
        for event_rows in by_event.values()
        for row in event_rows
        if int(row["gate_closed"]) == 0 and float(row["traffic_delay_seconds"]) < 100
    ]
    predictor = RailCrossPredictor(ROOT / "models")
    markers: list[dict[str, object]] = []
    closed_index = 0
    open_index = 0

    for index, crossing in enumerate(crossing_data["crossings"]):
        marker = dict(crossing)
        if crossing["barrier"] == "no":
            marker["prediction"] = {
                "predicted_status": "UNGATED",
                "closed_probability": None,
                "predicted_minutes_until_open": 0,
                "benchmark_scope": "not_applicable",
            }
        else:
            use_closed_example = index % 3 == 0
            if use_closed_example:
                row = closed_examples[closed_index % len(closed_examples)]
                closed_index += 1
            else:
                row = open_examples[open_index % len(open_examples)]
                open_index += 1
            features = {column: float(row[column]) for column in FEATURE_COLUMNS}
            marker["prediction"] = predictor.predict(features)
        marker["prediction_source"] = "RailCross model on synthetic feature snapshot"
        markers.append(marker)

    payload = {
        "mode": "synthetic_model_demo",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "model_evaluation": {
            "f1": 0.9439,
            "precision": 0.9489,
            "recall": 0.9389,
            "reopening_mae_minutes": 1.68,
            "scope": "held-out synthetic events",
        },
        "crossing_data": {
            "source": crossing_data["source"],
            "license": crossing_data["license"],
            "retrieved_at_utc": crossing_data["retrieved_at_utc"],
            "notes": crossing_data["notes"],
        },
        "crossings": markers,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return OUTPUT_PATH


if __name__ == "__main__":
    print(export())

