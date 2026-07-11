"""Train and evaluate RailCross status and reopening-time models."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    average_precision_score,
    brier_score_loss,
    mean_absolute_error,
    precision_score,
    recall_score,
    roc_auc_score,
)

from ml.simulate_crossings import FEATURE_COLUMNS


def load_dataset(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    features: list[list[float]] = []
    status_labels: list[int] = []
    remaining_labels: list[float] = []
    event_ids: list[int] = []
    timestamps: list[str] = []
    scenarios: list[str] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            features.append([float(row[column]) for column in FEATURE_COLUMNS])
            status_labels.append(int(row["gate_closed"]))
            remaining_labels.append(float(row["remaining_closed_seconds"]))
            event_ids.append(int(row["event_id"]))
            timestamps.append(row["timestamp_utc"])
            scenarios.append(row["scenario_kind"])
    return (
        np.asarray(features, dtype=float),
        np.asarray(status_labels, dtype=int),
        np.asarray(remaining_labels, dtype=float),
        np.asarray(event_ids, dtype=int),
        np.asarray(timestamps),
        np.asarray(scenarios),
    )


def split_masks(event_ids: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    unique_events = np.unique(event_ids)
    train_end = int(len(unique_events) * 0.70)
    validation_end = int(len(unique_events) * 0.85)
    train_events = unique_events[:train_end]
    validation_events = unique_events[train_end:validation_end]
    test_events = unique_events[validation_end:]
    return (
        np.isin(event_ids, train_events),
        np.isin(event_ids, validation_events),
        np.isin(event_ids, test_events),
    )


def false_positive_rate(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    matrix = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, _, _ = matrix.ravel()
    return float(fp / max(fp + tn, 1))


def choose_threshold(y_true: np.ndarray, probabilities: np.ndarray) -> float:
    candidates = np.linspace(0.20, 0.80, 61)
    best_threshold = 0.5
    best_score = -1.0
    for threshold in candidates:
        predictions = (probabilities >= threshold).astype(int)
        score = f1_score(y_true, predictions, zero_division=0) - 0.25 * false_positive_rate(y_true, predictions)
        if score > best_score:
            best_score = score
            best_threshold = float(threshold)
    return best_threshold


def classifier_metrics(y_true: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, Any]:
    predictions = (probabilities >= threshold).astype(int)
    matrix = confusion_matrix(y_true, predictions, labels=[0, 1])
    return {
        "accuracy": round(float(accuracy_score(y_true, predictions)), 4),
        "precision": round(float(precision_score(y_true, predictions, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, predictions, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, predictions, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, probabilities)), 4),
        "pr_auc": round(float(average_precision_score(y_true, probabilities)), 4),
        "brier_score": round(float(brier_score_loss(y_true, probabilities)), 4),
        "false_positive_rate": round(false_positive_rate(y_true, predictions), 4),
        "confusion_matrix": matrix.tolist(),
    }


def calibration_bins(y_true: np.ndarray, probabilities: np.ndarray, bins: int = 10) -> list[dict[str, float | int]]:
    """Return reliability-diagram data without adding a plotting dependency to training."""
    bucket = np.minimum((probabilities * bins).astype(int), bins - 1)
    result: list[dict[str, float | int]] = []
    for index in range(bins):
        mask = bucket == index
        if not np.any(mask):
            continue
        result.append({
            "bin": index,
            "count": int(np.sum(mask)),
            "mean_predicted_probability": round(float(np.mean(probabilities[mask])), 4),
            "observed_closure_rate": round(float(np.mean(y_true[mask])), 4),
        })
    return result


def scenario_metrics(
    y_true: np.ndarray, probabilities: np.ndarray, scenarios: np.ndarray, threshold: float
) -> dict[str, dict[str, Any]]:
    """Expose performance on railway closures and every hard-negative scenario."""
    report: dict[str, dict[str, Any]] = {}
    for scenario in sorted(set(str(value) for value in scenarios)):
        mask = scenarios == scenario
        predictions = (probabilities[mask] >= threshold).astype(int)
        report[scenario] = {
            "rows": int(np.sum(mask)),
            "actual_closure_rate": round(float(np.mean(y_true[mask])), 4),
            "predicted_closure_rate": round(float(np.mean(predictions)), 4),
            "false_positive_rate": round(false_positive_rate(y_true[mask], predictions), 4),
        }
    return report


def event_detection_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    event_ids: np.ndarray,
    timestamps: np.ndarray,
) -> dict[str, float]:
    detection_delays: list[float] = []
    closure_events = 0
    missed_events = 0
    for event_id in np.unique(event_ids):
        mask = event_ids == event_id
        event_truth = y_true[mask]
        if not event_truth.any():
            continue
        closure_events += 1
        actual_index = int(np.flatnonzero(event_truth == 1)[0])
        predicted_indexes = np.flatnonzero(y_pred[mask] == 1)
        predicted_indexes = predicted_indexes[predicted_indexes >= max(0, actual_index - 2)]
        if len(predicted_indexes) == 0:
            missed_events += 1
            continue
        predicted_index = int(predicted_indexes[0])
        actual_time = datetime.fromisoformat(str(timestamps[mask][actual_index]))
        predicted_time = datetime.fromisoformat(str(timestamps[mask][predicted_index]))
        detection_delays.append((predicted_time - actual_time).total_seconds())
    return {
        "closure_events": closure_events,
        "missed_event_rate": round(missed_events / max(closure_events, 1), 4),
        "median_detection_delay_seconds": round(float(np.median(detection_delays)), 1) if detection_delays else 0.0,
        "p90_detection_delay_seconds": round(float(np.percentile(detection_delays, 90)), 1) if detection_delays else 0.0,
    }


def train(
    dataset_path: Path,
    model_dir: Path,
    artifact_dir: Path,
) -> dict[str, Any]:
    X, y_status, y_remaining, event_ids, timestamps, scenarios = load_dataset(dataset_path)
    train_mask, validation_mask, test_mask = split_masks(event_ids)
    
    classifier = HistGradientBoostingClassifier(
        learning_rate=0.075,
        max_iter=180,
        max_leaf_nodes=19,
        min_samples_leaf=28,
        l2_regularization=1.4,
        random_state=42,
    )
    positive_weight = float(np.sum(train_mask & (y_status == 0)) / max(np.sum(train_mask & (y_status == 1)), 1))
    sample_weight = np.where(y_status[train_mask] == 1, positive_weight, 1.0)
    classifier.fit(X[train_mask], y_status[train_mask], sample_weight=sample_weight)
    
    validation_probabilities = classifier.predict_proba(X[validation_mask])[:, 1]
    threshold = choose_threshold(y_status[validation_mask], validation_probabilities)
    
    test_probabilities = classifier.predict_proba(X[test_mask])[:, 1]
    status_metrics = classifier_metrics(y_status[test_mask], test_probabilities, threshold)
    status_predictions = (test_probabilities >= threshold).astype(int)
    test_scenarios = scenarios[test_mask]
    detection_metrics = event_detection_metrics(
        y_status[test_mask], status_predictions, event_ids[test_mask], timestamps[test_mask]
    )

    baseline_predictions = (
        (X[test_mask, FEATURE_COLUMNS.index("traffic_delay_seconds")] > 125)
        & (X[test_mask, FEATURE_COLUMNS.index("queue_a_vehicles")] > 5)
        & (X[test_mask, FEATURE_COLUMNS.index("queue_b_vehicles")] > 5)
    ).astype(int)
    
    baseline_metrics = {
        "accuracy": round(float(accuracy_score(y_status[test_mask], baseline_predictions)), 4),
        "precision": round(float(precision_score(y_status[test_mask], baseline_predictions, zero_division=0)), 4),
        "recall": round(float(recall_score(y_status[test_mask], baseline_predictions, zero_division=0)), 4),
        "f1": round(float(f1_score(y_status[test_mask], baseline_predictions, zero_division=0)), 4),
        "false_positive_rate": round(false_positive_rate(y_status[test_mask], baseline_predictions), 4),
    }

    # Survival Model for Reopening Time
    train_closed = train_mask & (y_status == 1)
    test_closed = test_mask & (y_status == 1)
    
    horizons = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600]
    
    X_train_closed = X[train_closed]
    y_train_remaining = y_remaining[train_closed]
    
    X_surv_list = []
    y_surv_list = []
    for i in range(len(X_train_closed)):
        for T in horizons:
            # Concatenate original features with horizon value as a feature
            feat = np.append(X_train_closed[i], T)
            # Label = 1 if still closed at T, 0 if reopened by T
            label = 1 if y_train_remaining[i] > T else 0
            X_surv_list.append(feat)
            y_surv_list.append(label)
            
    X_surv = np.asarray(X_surv_list)
    y_surv = np.asarray(y_surv_list)
    
    regressor = HistGradientBoostingClassifier(
        learning_rate=0.065,
        max_iter=190,
        max_leaf_nodes=17,
        min_samples_leaf=24,
        l2_regularization=1.2,
        random_state=42,
    )
    regressor.fit(X_surv, y_surv)

    # Test predictions using the survival model
    X_test_closed = X[test_closed]
    y_test_remaining = y_remaining[test_closed]
    
    test_medians = []
    for x in X_test_closed:
        batch = np.asarray([np.append(x, T) for T in horizons])
        # P(still closed)
        probs = regressor.predict_proba(batch)[:, 1]
        
        # Find median (where P still closed drops below 0.5)
        idx = np.where(probs < 0.5)[0]
        if len(idx) > 0:
            k = idx[0]
            t_prev = horizons[k-1] if k > 0 else 0
            s_prev = probs[k-1] if k > 0 else 1.0
            t_next = horizons[k]
            s_next = probs[k]
            denom = s_prev - s_next
            if denom > 0:
                t_med = t_prev + (t_next - t_prev) * (s_prev - 0.5) / denom
            else:
                t_med = t_next
        else:
            t_med = 600.0
        test_medians.append(t_med)
        
    test_medians = np.asarray(test_medians)
    absolute_errors = np.abs(y_test_remaining - test_medians)
    
    # Calculate simple calibration metric: mean absolute calibration error at T=180s
    # actual fraction reopened by 180s vs mean predicted probability of being reopened
    actual_reopened_180 = (y_test_remaining <= 180).astype(int)
    batch_180 = np.asarray([np.append(x, 180) for x in X_test_closed])
    pred_still_closed_180 = regressor.predict_proba(batch_180)[:, 1]
    pred_reopened_180 = 1.0 - pred_still_closed_180
    calibration_error_180 = float(np.abs(np.mean(actual_reopened_180) - np.mean(pred_reopened_180)))

    reopening_metrics = {
        "mae_minutes": round(float(mean_absolute_error(y_test_remaining, test_medians) / 60), 3),
        "median_absolute_error_minutes": round(float(np.median(absolute_errors) / 60), 3),
        "within_2_minutes": round(float(np.mean(absolute_errors <= 120)), 4),
        "calibration_error_180s": round(calibration_error_180, 4),
    }

    permutation_importance: list[tuple[str, float]] = []
    rng = np.random.default_rng(42)
    base_f1 = f1_score(y_status[test_mask], status_predictions, zero_division=0)
    for index, feature_name in enumerate(FEATURE_COLUMNS):
        shuffled = X[test_mask].copy()
        rng.shuffle(shuffled[:, index])
        shuffled_predictions = (classifier.predict_proba(shuffled)[:, 1] >= threshold).astype(int)
        importance = max(0.0, base_f1 - f1_score(y_status[test_mask], shuffled_predictions, zero_division=0))
        permutation_importance.append((feature_name, round(float(importance), 5)))
    permutation_importance.sort(key=lambda item: item[1], reverse=True)

    model_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    classifier_path = model_dir / "status_classifier.joblib"
    regressor_path = model_dir / "reopening_regressor.joblib"
    
    joblib.dump({"model": classifier, "feature_columns": FEATURE_COLUMNS, "threshold": threshold}, classifier_path)
    joblib.dump({"model": regressor, "feature_columns": FEATURE_COLUMNS, "horizons": horizons}, regressor_path)

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "path": str(dataset_path),
            "source": "Google-Routes-like synthetic simulator; not Google internal data",
            "rows": int(len(y_status)),
            "events": int(len(np.unique(event_ids))),
            "positive_rate": round(float(np.mean(y_status)), 4),
            "split": "Chronological event split: 70% train, 15% validation, 15% test",
        },
        "classifier": {
            "model": "HistGradientBoostingClassifier",
            "threshold": round(threshold, 3),
            "test_metrics": status_metrics,
            "calibration_bins": calibration_bins(y_status[test_mask], test_probabilities),
            "scenario_metrics": scenario_metrics(y_status[test_mask], test_probabilities, test_scenarios, threshold),
            "ablation_note": "The trained classifier intentionally uses traffic-derived features only. Schedule priors and crowdsourced consensus are independent fusion inputs applied at serving time; they require a labelled real-world evaluation before a comparative ablation is claimed.",
            "event_detection": detection_metrics,
            "top_permutation_features": permutation_importance[:8],
        },
        "baseline_rule": baseline_metrics,
        "reopening_regressor": {
            "model": "HistGradientBoostingClassifier_Survival",
            "test_metrics": reopening_metrics,
        },
        "resume_claim_status": "Synthetic benchmark only. Real-world accuracy must be measured on independently labelled crossing events before external accuracy claims.",
    }
    
    report_path = artifact_dir / "model_evaluation.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    (model_dir / "metadata.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=Path("data/synthetic/crossing_observations.csv"))
    parser.add_argument("--model-dir", type=Path, default=Path("models"))
    parser.add_argument("--artifact-dir", type=Path, default=Path("artifacts"))
    args = parser.parse_args()
    report = train(args.dataset, args.model_dir, args.artifact_dir)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
