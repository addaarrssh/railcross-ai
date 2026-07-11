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

    def _interpolate_percentile(self, horizons: list[float], probs: np.ndarray, threshold: float) -> float:
        # Assumes horizons are sorted ascending, and probs (P_still_closed) decrease
        idx = np.where(probs < threshold)[0]
        if len(idx) > 0:
            k = idx[0]
            t_prev = horizons[k - 1] if k > 0 else 0.0
            s_prev = float(probs[k - 1]) if k > 0 else 1.0
            t_next = horizons[k]
            s_next = float(probs[k])
            denom = s_prev - s_next
            if denom > 0:
                return t_prev + (t_next - t_prev) * (s_prev - threshold) / denom
            return t_next
        return float(horizons[-1])

    def predict(self, observation: dict[str, float]) -> dict[str, Any]:
        missing = [column for column in self.feature_columns if column not in observation]
        if missing:
            raise ValueError(f"Missing model features: {', '.join(missing)}")
            
        vector = np.asarray([[float(observation[column]) for column in self.feature_columns]])
        raw_probability = float(self.status_bundle["model"].predict_proba(vector)[0, 1])
        
        threshold = float(self.status_bundle["threshold"])
        is_closed = raw_probability >= threshold
        
        survival_curve = []
        median_minutes = 0.0
        ci_80_low_minutes = 0.0
        ci_80_high_minutes = 0.0
        
        if is_closed:
            horizons = self.reopening_bundle["horizons"]
            model = self.reopening_bundle["model"]
            
            # Predict survival probability at each horizon
            batch = np.asarray([np.append(vector[0], T) for T in horizons])
            probs = model.predict_proba(batch)[:, 1] # P(still closed)
            
            for T, p in zip(horizons, probs):
                survival_curve.append({
                    "time_seconds": int(T),
                    "probability_still_closed": round(float(p), 4)
                })
                
            median_seconds = self._interpolate_percentile(horizons, probs, 0.50)
            ci_80_low_seconds = self._interpolate_percentile(horizons, probs, 0.90)
            ci_80_high_seconds = self._interpolate_percentile(horizons, probs, 0.10)
            
            median_minutes = round(median_seconds / 60, 2)
            ci_80_low_minutes = round(ci_80_low_seconds / 60, 2)
            ci_80_high_minutes = round(ci_80_high_seconds / 60, 2)

        return {
            "predicted_status": "CLOSED" if is_closed else "OPEN",
            "closed_probability": round(raw_probability, 4),
            "decision_threshold": round(threshold, 4),
            "predicted_minutes_until_open": median_minutes,
            "ci_80_low_minutes": ci_80_low_minutes,
            "ci_80_high_minutes": ci_80_high_minutes,
            "survival_curve": survival_curve,
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
