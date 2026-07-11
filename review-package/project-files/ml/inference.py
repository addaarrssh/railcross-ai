"""Load trained RailCross models and score one traffic observation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np


class RailCrossPredictor:
    def __init__(self, model_dir: Path = Path("models")) -> None:
        self.status_bundle = joblib.load(model_dir / "status_classifier.joblib")
        self.reopening_bundle = joblib.load(model_dir / "reopening_regressor.joblib")

    @property
    def feature_columns(self) -> list[str]:
        return list(self.status_bundle["feature_columns"])

    def predict(self, observation: dict[str, float]) -> dict[str, Any]:
        missing = [column for column in self.feature_columns if column not in observation]
        if missing:
            raise ValueError(f"Missing model features: {', '.join(missing)}")
        vector = np.asarray([[float(observation[column]) for column in self.feature_columns]])
        probability = float(self.status_bundle["model"].predict_proba(vector)[0, 1])
        threshold = float(self.status_bundle["threshold"])
        is_closed = probability >= threshold
        remaining_seconds = 0.0
        if is_closed:
            remaining_seconds = max(0.0, float(self.reopening_bundle["model"].predict(vector)[0]))
        return {
            "predicted_status": "CLOSED" if is_closed else "OPEN",
            "closed_probability": round(probability, 4),
            "decision_threshold": round(threshold, 4),
            "predicted_minutes_until_open": round(remaining_seconds / 60, 2),
            "benchmark_scope": "synthetic",
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("observation", type=Path, help="JSON object containing every model feature")
    parser.add_argument("--model-dir", type=Path, default=Path("models"))
    args = parser.parse_args()
    observation = json.loads(args.observation.read_text(encoding="utf-8"))
    print(json.dumps(RailCrossPredictor(args.model_dir).predict(observation), indent=2))


if __name__ == "__main__":
    main()

