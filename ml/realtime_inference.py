"""Run model inference on real-time Routes API traffic observations."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from ml.inference import RailCrossPredictor
from ml.simulate_crossings import FEATURE_COLUMNS


def run_inference(
    csv_path: Path, 
    model_dir: Path, 
    output_path: Path
) -> None:
    if not csv_path.exists():
        print(f"Observations CSV not found: {csv_path}")
        return

    # Read all observations from the CSV
    observations: dict[str, dict] = {}
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            crossing_id = row["crossing_id"]
            # Keep only the latest observation per crossing
            observations[crossing_id] = row

    predictor = RailCrossPredictor(model_dir)
    results = {}
    
    for crossing_id, obs in observations.items():
        # Convert values to float for features
        features = {}
        for col in FEATURE_COLUMNS:
            features[col] = float(obs[col])
            
        prediction = predictor.predict(features)
        
        # Override benchmark scope and source tags
        prediction["benchmark_scope"] = "realtime"
        prediction["data_source"] = "routes_api"
        prediction["timestamp_utc"] = obs["timestamp_utc"]
        
        results[crossing_id] = prediction

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Successfully wrote {len(results)} real-time predictions to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observations", type=Path, default=Path("data/realtime/routes_observations.csv"))
    parser.add_argument("--model-dir", type=Path, default=Path("models"))
    parser.add_argument("--output", type=Path, default=Path("public/jharkhand_realtime_predictions.json"))
    args = parser.parse_args()
    
    run_inference(args.observations, args.model_dir, args.output)


if __name__ == "__main__":
    main()
