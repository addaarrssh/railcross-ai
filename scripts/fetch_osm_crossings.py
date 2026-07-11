#!/usr/bin/env python3
"""Fetch vehicle railway level crossings for the RailCross pilot."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "RailCrossAI student project coordinate research"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "data" / "crossings"
PUBLIC_DIR = PROJECT_ROOT / "public"


def run_query(query: str) -> list[dict]:
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
        # Determine district or county from tags or fallback to admin state name
        district = tags.get("addr:district") or tags.get("addr:county") or "Pilot Area"
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=str, default="jharkhand", choices=["jharkhand", "bihar", "both"])
    parser.add_argument("--bbox", type=str, help="Bounding box coordinates: min_lat,min_lon,max_lat,max_lon")
    args = parser.parse_args()

    records = []

    if args.bbox:
        print(f"Fetching crossings for custom bounding box: {args.bbox}")
        query = (
            f"[out:json][timeout:180];"
            f'node["railway"="level_crossing"]({args.bbox});'
            f"out body;"
        )
        records.extend(run_query(query))
    else:
        states = []
        if args.state in ["jharkhand", "both"]:
            states.append("Jharkhand")
        if args.state in ["bihar", "both"]:
            states.append("Bihar")

        for state in states:
            print(f"Fetching crossings for state: {state}")
            query = (
                f"[out:json][timeout:180];"
                f'area["name"="{state}"]["admin_level"="4"]->.searchArea;'
                f'node["railway"="level_crossing"](area.searchArea);'
                f"out body;"
            )
            records.extend(run_query(query))

    records.sort(key=lambda row: (row["district"], row["osm_node_id"]))
    
    # Deduplicate by OSM Node ID
    seen_ids = set()
    deduped_records = []
    for r in records:
        if r["osm_node_id"] not in seen_ids:
            seen_ids.add(r["osm_node_id"])
            deduped_records.append(r)
            
    print(f"Found {len(deduped_records)} unique crossings.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    
    payload = {
        "metadata": {
            "fetched_at": fetched_at,
            "source": "OpenStreetMap via Overpass API",
            "license": "ODbL 1.0",
            "feature_filter": "node[railway=level_crossing]",
            "scope": f"{args.state} state(s)" if not args.bbox else "custom bounding box",
            "total": len(deduped_records),
        },
        "crossings": deduped_records,
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
        writer.writerows(deduped_records)

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    map_payload = {
        "total": len(deduped_records),
        "crossings": [
            {
                "id": row["id"],
                "osm_node_id": row["osm_node_id"],
                "district": row["district"],
                "lat": row["latitude"],
                "lng": row["longitude"],
                "barrier": row["crossing_barrier"],
            }
            for row in deduped_records
        ],
    }
    map_path = PUBLIC_DIR / "jharkhand_level_crossings.json"
    map_path.write_text(json.dumps(map_payload, separators=(",", ":")) + "\n", encoding="utf-8")

    print(json.dumps(payload["metadata"], indent=2))


if __name__ == "__main__":
    main()
