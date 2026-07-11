"""Create map-ready predictions for every pilot crossing using new models.

Includes survival curves, Bayesian prior updates from schedules, and batched exports.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from ml.inference import RailCrossPredictor
from ml.schedule_prior import get_schedule_prior
from ml.simulate_crossings import FEATURE_COLUMNS, SimulationConfig, generate_rows


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / "data" / "crossings" / "jharkhand_pilot_level_crossings.json"
EVALUATION_PATH = ROOT / "artifacts" / "model_evaluation.json"
OUTPUT_PATH = ROOT / "public" / "jharkhand_crossing_predictions.json"


def movement_label(speed_kph: float, stopped_ratio: float) -> str:
    if speed_kph < 5 or stopped_ratio >= 0.70:
        return "STOPPED"
    if speed_kph < 18 or stopped_ratio >= 0.35:
        return "SLOW"
    return "MOVING"


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
        
        # Calculate schedule-based Bayesian prior
        prior = get_schedule_prior(crossing["id"], now)
        prediction = predictor.predict(features, crossing_prior=prior)
        
        speed_a = features["approach_a_speed_kph"]
        speed_b = features["approach_b_speed_kph"]
        stopped_a = features["stopped_vehicle_ratio_a"]
        stopped_b = features["stopped_vehicle_ratio_b"]

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
                    "approach_a_speed_kph": round(speed_a, 1),
                    "approach_b_speed_kph": round(speed_b, 1),
                    "approach_a_movement": movement_label(speed_a, stopped_a),
                    "approach_b_movement": movement_label(speed_b, stopped_b),
                    "stopped_vehicle_ratio_a": round(stopped_a, 3),
                    "stopped_vehicle_ratio_b": round(stopped_b, 3),
                    "queue_a_vehicles": round(features["queue_a_vehicles"], 1),
                    "queue_b_vehicles": round(features["queue_b_vehicles"], 1),
                    "queue_growth_vehicles_per_minute": round(features["queue_growth_vehicles_per_minute"], 1),
                    "traffic_delay_seconds": round(features["traffic_delay_seconds"], 1),
                    "congestion_age_minutes": round(features["congestion_age_minutes"], 1),
                    "survival_curve": prediction.get("survival_curve", []),
                },
            }
        )

    status_counts = {
        status: sum(marker["prediction"]["predicted_status"] == status for marker in markers)
        for status in ("OPEN", "CLOSED")
    }
    
    output = {
        "mode": "traffic_first_synthetic_model_demo",
        "generated_at_utc": now.replace(microsecond=0).isoformat(),
        "warning": "Predictions use synthetic traffic snapshots, not live Google traffic or verified gate states.",
        "model": {
            "features": FEATURE_COLUMNS,
            "test_metrics": evaluation["classifier"]["test_metrics"],
            "event_detection": evaluation["classifier"]["event_detection"],
            "reopening_metrics": evaluation["reopening_regressor"]["test_metrics"],
        },
        "total": len(markers),
        "status_counts": status_counts,
        "crossings": markers,
    }
    
    OUTPUT_PATH.write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")
    
    # Also write a duplicate to public/crossings.json for compatibility with other demos
    (ROOT / "public" / "crossings.json").write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")
    
    return OUTPUT_PATH


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="Limit number of crossings to export")
    args = parser.parse_args()
    print(export(args.limit))
