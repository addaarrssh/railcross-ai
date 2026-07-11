"""Poll Google Routes traffic fields for two approaches to a level crossing.

The output deliberately contains only API-observable route fields plus values
calculated from previous polls. Google does not expose device counts, vehicle
queues, stopped-vehicle ratios, or an authoritative gate state.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


FEATURE_COLUMNS = [
    "route_static_duration_seconds",
    "route_duration_seconds",
    "traffic_delay_seconds",
    "approach_a_speed_code",
    "approach_b_speed_code",
    "both_approaches_jammed",
    "traffic_delay_change_1min_seconds",
    "both_approaches_jammed_minutes",
    "traffic_delay_rolling_3min_seconds",
    "traffic_delay_rolling_10min_seconds",
]

SPEED_CODES = {"NORMAL": 0, "SLOW": 1, "TRAFFIC_JAM": 2}


def offset_point(latitude: float, longitude: float, bearing: float, distance_meters: float) -> tuple[float, float]:
    earth_radius_meters = 6_378_137.0
    latitude_offset = (distance_meters * np.cos(np.radians(bearing))) / earth_radius_meters
    longitude_offset = (distance_meters * np.sin(np.radians(bearing))) / (
        earth_radius_meters * np.cos(np.radians(latitude))
    )
    return latitude + np.degrees(latitude_offset), longitude + np.degrees(longitude_offset)


def parse_seconds(value: str) -> float:
    return float(value.removesuffix("s"))


def fetch_approach_summary(
    origin: tuple[float, float], destination: tuple[float, float], api_key: str
) -> dict[str, float] | None:
    request_body = {
        "origin": {"location": {"latLng": {"latitude": origin[0], "longitude": origin[1]}}},
        "destination": {"location": {"latLng": {"latitude": destination[0], "longitude": destination[1]}}},
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "extraComputations": ["TRAFFIC_ON_POLYLINE"],
        "computeAlternativeRoutes": False,
    }
    request = urllib.request.Request(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.travelAdvisory.speedReadingIntervals",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as error:
        print(f"Routes request failed: {error}")
        return None

    routes = payload.get("routes", [])
    if not routes:
        return None
    route = routes[0]
    intervals = route.get("travelAdvisory", {}).get("speedReadingIntervals", [])
    worst_speed_code = max((SPEED_CODES.get(item.get("speed"), 0) for item in intervals), default=0)
    duration = parse_seconds(route.get("duration", "0s"))
    static_duration = parse_seconds(route.get("staticDuration", "0s"))
    return {
        "duration": duration,
        "static_duration": static_duration,
        "speed_code": float(worst_speed_code),
    }


def build_observation(
    crossing: dict[str, Any], api_key: str, history: list[dict[str, float]]
) -> dict[str, float | str] | None:
    latitude = float(crossing["latitude"])
    longitude = float(crossing["longitude"])
    crossing_point = (latitude, longitude)
    north_approach = offset_point(latitude, longitude, 0.0, 250.0)
    south_approach = offset_point(latitude, longitude, 180.0, 250.0)

    approach_a = fetch_approach_summary(north_approach, crossing_point, api_key)
    approach_b = fetch_approach_summary(south_approach, crossing_point, api_key)
    if not approach_a or not approach_b:
        return None

    static_duration = approach_a["static_duration"] + approach_b["static_duration"]
    route_duration = approach_a["duration"] + approach_b["duration"]
    traffic_delay = max(0.0, route_duration - static_duration)
    both_jammed = int(approach_a["speed_code"] == 2 and approach_b["speed_code"] == 2)
    prior_delay = history[-2]["traffic_delay_seconds"] if len(history) >= 2 else traffic_delay
    prior_jam_duration = history[-1]["both_approaches_jammed_minutes"] if history else 0.0
    jam_duration = prior_jam_duration + 0.5 if both_jammed else 0.0
    delay_history = [item["traffic_delay_seconds"] for item in history] + [traffic_delay]

    return {
        "crossing_id": str(crossing["id"]),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "route_static_duration_seconds": round(static_duration, 2),
        "route_duration_seconds": round(route_duration, 2),
        "traffic_delay_seconds": round(traffic_delay, 2),
        "approach_a_speed_code": int(approach_a["speed_code"]),
        "approach_b_speed_code": int(approach_b["speed_code"]),
        "both_approaches_jammed": both_jammed,
        "traffic_delay_change_1min_seconds": round(traffic_delay - prior_delay, 2),
        "both_approaches_jammed_minutes": round(jam_duration, 2),
        "traffic_delay_rolling_3min_seconds": round(float(np.mean(delay_history[-6:])), 2),
        "traffic_delay_rolling_10min_seconds": round(float(np.mean(delay_history[-20:])), 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crossings", type=Path, default=Path("data/crossings/jharkhand_pilot_level_crossings.json"))
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--output", type=Path, default=Path("data/realtime/routes_observations.csv"))
    parser.add_argument("--interval", type=int, default=30, help="Seconds between polls")
    parser.add_argument("--max-crossings", type=int, default=5)
    args = parser.parse_args()

    crossings = json.loads(args.crossings.read_text(encoding="utf-8")).get("crossings", [])[: args.max_crossings]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    history: dict[str, list[dict[str, float]]] = defaultdict(list)
    write_header = not args.output.exists()

    while True:
        observations: list[dict[str, float | str]] = []
        for crossing in crossings:
            crossing_history = history[str(crossing["id"])]
            observation = build_observation(crossing, args.api_key, crossing_history)
            if observation:
                observations.append(observation)
                crossing_history.append({column: float(observation[column]) for column in FEATURE_COLUMNS})
                del crossing_history[:-20]
            time.sleep(0.5)

        if observations:
            with args.output.open("a", newline="", encoding="utf-8") as output_file:
                writer = csv.DictWriter(output_file, fieldnames=["crossing_id", "timestamp_utc", *FEATURE_COLUMNS])
                if write_header:
                    writer.writeheader()
                    write_header = False
                writer.writerows(observations)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
