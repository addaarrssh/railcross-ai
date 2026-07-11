#!/usr/bin/env python3
"""Fetch vehicle railway level crossings for the RailCross Jharkhand pilot."""

from __future__ import annotations

import csv
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "RailCrossAI student project coordinate research"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "data" / "crossings"
PUBLIC_DIR = PROJECT_ROOT / "public"

AREAS = (
    ("Latehar", 9510815),
    ("Ranchi", 1972023),
    ("East Singhbhum", 1972030),
)


def fetch_area(district: str, relation_id: int) -> list[dict]:
    area_id = 3_600_000_000 + relation_id
    query = (
        "[out:json][timeout:180];"
        f"area({area_id})->.searchArea;"
        'node["railway"="level_crossing"](area.searchArea);'
        "out body;"
    )
    result = subprocess.run(
        [
            "curl",
            "-fsS",
            "--get",
            OVERPASS_URL,
            "--data-urlencode",
            f"data={query}",
            "-H",
            f"User-Agent: {USER_AGENT}",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)

    records = []
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        osm_node_id = element["id"]
        records.append(
            {
                "id": f"osm-node-{osm_node_id}",
                "osm_node_id": osm_node_id,
                "district": district,
                "latitude": element["lat"],
                "longitude": element["lon"],
                "name": tags.get("name"),
                "crossing_barrier": tags.get("crossing:barrier"),
                "crossing_activation": tags.get("crossing:activation"),
                "crossing_supervision": tags.get("crossing:supervision"),
                "crossing_light": tags.get("crossing:light"),
                "crossing_bell": tags.get("crossing:bell"),
                "access": tags.get("access"),
                "osm_url": f"https://www.openstreetmap.org/node/{osm_node_id}",
                "osm_tags": tags,
            }
        )
    return records


def main() -> None:
    records = []
    for district, relation_id in AREAS:
        records.extend(fetch_area(district, relation_id))

    records.sort(key=lambda row: (row["district"], row["osm_node_id"]))
    unique_ids = {row["osm_node_id"] for row in records}
    if len(unique_ids) != len(records):
        raise RuntimeError("Duplicate OpenStreetMap node IDs were returned.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    counts = {
        district: sum(row["district"] == district for row in records)
        for district, _ in AREAS
    }
    payload = {
        "metadata": {
            "fetched_at": fetched_at,
            "source": "OpenStreetMap via Overpass API",
            "license": "ODbL 1.0",
            "feature_filter": "node[railway=level_crossing]",
            "scope": "Latehar, Ranchi, and East Singhbhum administrative districts",
            "jamshedpur_note": "East Singhbhum is used as the district containing Jamshedpur.",
            "coverage_warning": "OpenStreetMap is contributor-maintained and may not contain every real-world crossing.",
            "counts_by_district": counts,
            "total": len(records),
        },
        "crossings": records,
    }

    json_path = OUTPUT_DIR / "jharkhand_pilot_level_crossings.json"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    csv_path = OUTPUT_DIR / "jharkhand_pilot_level_crossings.csv"
    csv_fields = (
        "id",
        "osm_node_id",
        "district",
        "latitude",
        "longitude",
        "name",
        "crossing_barrier",
        "crossing_activation",
        "crossing_supervision",
        "crossing_light",
        "crossing_bell",
        "access",
        "osm_url",
    )
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=csv_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    map_payload = {
        "total": len(records),
        "crossings": [
            {
                "id": row["id"],
                "osm_node_id": row["osm_node_id"],
                "district": row["district"],
                "lat": row["latitude"],
                "lng": row["longitude"],
                "barrier": row["crossing_barrier"],
            }
            for row in records
        ],
    }
    map_path = PUBLIC_DIR / "jharkhand_level_crossings.json"
    map_path.write_text(json.dumps(map_payload, separators=(",", ":")) + "\n", encoding="utf-8")

    print(json.dumps(payload["metadata"], indent=2))


if __name__ == "__main__":
    main()
