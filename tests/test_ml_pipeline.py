from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from ml.inference import MAX_OBSERVATION_AGE_SECONDS, decide_status
from ml.simulate_crossings import CROSSING_PROFILES, FEATURE_COLUMNS, SimulationConfig, write_dataset
from ml.train_models import HOLDOUT_CROSSINGS


class SimulatorTests(unittest.TestCase):
    def test_dataset_is_deterministic_and_consistent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.csv"
            second = Path(directory) / "second.csv"
            config = SimulationConfig(events=18, steps_per_event=30, seed=7)
            first_summary = write_dataset(first, config)
            second_summary = write_dataset(second, config)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(first_summary["rows"], 540)
            self.assertGreater(first_summary["closed_rows"], 0)

            with first.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertTrue(all(column in rows[0] for column in FEATURE_COLUMNS))
            self.assertTrue(all(int(row["gate_closed"]) in {0, 1} for row in rows))
            self.assertTrue(all(float(row["remaining_closed_seconds"]) == 0 for row in rows if row["gate_closed"] == "0"))
            self.assertTrue(all(float(row["remaining_closed_seconds"]) > 0 for row in rows if row["gate_closed"] == "1"))

    def test_crossing_profiles_support_holdout_evaluation(self) -> None:
        profile_ids = [profile[0] for profile in CROSSING_PROFILES]
        self.assertEqual(len(profile_ids), len(set(profile_ids)))
        self.assertGreaterEqual(len(profile_ids), 10)
        for holdout in HOLDOUT_CROSSINGS:
            self.assertIn(holdout, profile_ids)
        # Holdout must never swallow every crossing.
        self.assertLess(len(HOLDOUT_CROSSINGS), len(profile_ids) / 2)

    def test_full_default_dataset_covers_every_crossing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dataset.csv"
            write_dataset(path, SimulationConfig(events=len(CROSSING_PROFILES), steps_per_event=20, seed=3))
            with path.open(newline="", encoding="utf-8") as handle:
                crossing_ids = {row["crossing_id"] for row in csv.DictReader(handle)}
            self.assertEqual(crossing_ids, {profile[0] for profile in CROSSING_PROFILES})


class DecideStatusTests(unittest.TestCase):
    BAND = (0.25, 0.55)
    THRESHOLD = 0.40

    def test_confident_probabilities_decide(self) -> None:
        self.assertEqual(decide_status(0.05, self.THRESHOLD, self.BAND), ("OPEN", "confident_open"))
        self.assertEqual(decide_status(0.90, self.THRESHOLD, self.BAND), ("CLOSED", "confident_closed"))

    def test_uncertain_probability_abstains(self) -> None:
        status, reason = decide_status(0.40, self.THRESHOLD, self.BAND)
        self.assertEqual(status, "UNKNOWN")
        self.assertEqual(reason, "low_confidence_probability")

    def test_stale_observation_abstains_even_when_confident(self) -> None:
        status, reason = decide_status(
            0.95, self.THRESHOLD, self.BAND, observation_age_seconds=MAX_OBSERVATION_AGE_SECONDS + 1
        )
        self.assertEqual(status, "UNKNOWN")
        self.assertEqual(reason, "stale_observation")

    def test_missing_band_falls_back_to_threshold(self) -> None:
        self.assertEqual(decide_status(0.41, self.THRESHOLD, None), ("CLOSED", "confident_closed"))
        self.assertEqual(decide_status(0.39, self.THRESHOLD, None), ("OPEN", "confident_open"))


if __name__ == "__main__":
    unittest.main()

