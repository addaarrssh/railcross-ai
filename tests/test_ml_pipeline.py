from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from ml.simulate_crossings import FEATURE_COLUMNS, SimulationConfig, write_dataset


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


if __name__ == "__main__":
    unittest.main()

