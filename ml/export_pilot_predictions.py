"""Create map-ready synthetic predictions using Google-Routes-observable fields."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ml.inference import RailCrossPredictor
from ml.simulate_crossings import FEATURE_COLUMNS, SimulationConfig, generate_rows


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / "data" / "crossings" / "jharkhand_pilot_level_crossings.json"
EVALUATION_PATH = ROOT / "artifacts" / "model_evaluation.json"
OUTPUT_PATH = ROOT / "public" / "jharkhand_crossing_predictions.json"


def traffic_label(speed_code: float) -> str:
    return ("NORMAL", "SLOW", "TRAFFIC_JAM")[int(speed_code)]


def export(limit: int | None = None) -> Path:
    crossing_payload = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    evaluation = json.loads(EVALUATION_PATH.read_text(encoding="utf-8"))
    predictor = RailCrossPredictor(ROOT / "models")
    
    # Generate a larger synthetic pool to sample traffic snapshots from
    synthetic_rows = generate_rows(SimulationConfig(events=300, seed=2026))
    rng = np.random.default_rng(2026)
    
    crossings = crossing_payload["crossings"]
    if limit is not None:
        crossings = crossings[:limit]
        
    sampled_indexes = rng.integers(0, len(synthetic_rows), size=len(crossings))
    now = datetime.now(timezone.utc)

    markers = []
    for crossing, row_index in zip(crossings, sampled_indexes, strict=True):
        row = synthetic_rows[int(row_index)]
        features = {column: float(row[column]) for column in FEATURE_COLUMNS}
        
        prediction = predictor.predict(features)
        
        markers.append(
            {
                "id": crossing["id"],
                "osm_node_id": crossing["osm_node_id"],
                "district": crossing["district"],
                "lat": crossing["latitude"],
                "lng": crossing["longitude"],
                "barrier": crossing["crossing_barrier"],
                "prediction": prediction,
                "traffic_snapshot": {
                    "approach_a_traffic": traffic_label(features["approach_a_speed_code"]),
                    "approach_b_traffic": traffic_label(features["approach_b_speed_code"]),
                    "traffic_delay_seconds": round(features["traffic_delay_seconds"], 1),
                    "traffic_delay_change_1min_seconds": round(
                        features["traffic_delay_change_1min_seconds"], 1
                    ),
                    "both_approaches_jammed_minutes": round(
                        features["both_approaches_jammed_minutes"], 1
                    ),
                    "survival_curve": prediction.get("survival_curve", []),
                },
            }
        )

    status_counts = {
        status: sum(marker["prediction"]["predicted_status"] == status for marker in markers)
        for status in ("OPEN", "CLOSED", "UNKNOWN")
    }

    output = {
        "mode": "traffic_first_synthetic_model_demo",
        "generated_at_utc": now.replace(microsecond=0).isoformat(),
        "warning": "Predictions use synthetic traffic snapshots, not live Google traffic or verified gate states.",
        "model": {
            "features": FEATURE_COLUMNS,
            "test_metrics": evaluation["classifier"]["test_metrics"],
            "unseen_crossing_test_metrics": evaluation["classifier"]["unseen_crossing_test_metrics"],
            "abstention": evaluation["classifier"]["abstention"],
            "event_detection": evaluation["classifier"]["event_detection"],
            "reopening_metrics": evaluation["reopening_regressor"]["test_metrics"],
        },
        "total": len(markers),
        "status_counts": status_counts,
        "crossings": markers,
    }
    
    OUTPUT_PATH.write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")
    
    return OUTPUT_PATH


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="Limit number of crossings to export")
    args = parser.parse_args()
    print(export(args.limit))
