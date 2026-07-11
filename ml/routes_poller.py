"""Poll Google Routes API for real-time traffic features near level crossings."""

from __future__ import annotations

import argparse
import csv
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def compute_haversine_destination(lat: float, lng: float, bearing: float, distance_meters: float) -> tuple[float, float]:
    # Simple flat-earth approximation for small distances
    r_earth = 6378137.0
    d_lat = (distance_meters * np.cos(np.radians(bearing))) / r_earth
    d_lng = (distance_meters * np.sin(np.radians(bearing))) / (r_earth * np.cos(np.radians(lat)))
    return lat + np.degrees(d_lat), lng + np.degrees(d_lng)


def poll_crossing_traffic(
    crossing: dict, 
    api_key: str
) -> dict | None:
    lat = float(crossing["latitude"])
    lng = float(crossing["longitude"])
    crossing_id = crossing["id"]

    # Define route segment: 250m before and 250m after crossing (North-South route)
    origin_lat, origin_lng = compute_haversine_destination(lat, lng, 0.0, 250.0)      # North
    dest_lat, dest_lng = compute_haversine_destination(lat, lng, 180.0, 250.0)       # South

    url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-Fieldmask": "routes.duration,routes.staticDuration,routes.travelAdvisory.speedReadingIntervals",
    }
    body = {
        "origin": {
            "location": {
                "latLng": {
                    "latitude": origin_lat,
                    "longitude": origin_lng
                }
            }
        },
        "destination": {
            "location": {
                "latLng": {
                    "latitude": dest_lat,
                    "longitude": dest_lng
                }
            }
        },
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "computeAlternativeRoutes": False,
    }

    req = urllib.request.Request(
        url, 
        data=json.dumps(body).encode("utf-8"), 
        headers=headers, 
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            
        if "routes" not in res_data or not res_data["routes"]:
            return None
            
        route = res_data["routes"][0]
        
        # Duration format is a string ending with 's' (e.g. '125s')
        def parse_seconds(val_str: str) -> float:
            return float(val_str.rstrip("s"))
            
        duration = parse_seconds(route.get("duration", "0s"))
        static_duration = parse_seconds(route.get("staticDuration", "0s"))
        delay = max(0.0, duration - static_duration)
        
        # Extract approach speeds if speedReadingIntervals is available
        # default to estimatives based on free flow if not present
        free_flow_speed = 35.0  # default
        speed_a = free_flow_speed
        speed_b = free_flow_speed
        
        advisory = route.get("travelAdvisory", {})
        intervals = advisory.get("speedReadingIntervals", [])
        if intervals:
            # Map interval speed codes to actual speeds
            # Speed codes: 1=NORMAL, 2=SLOW, 3=JAM (represented as floats/integers)
            speeds = []
            for interval in intervals:
                speed_code = interval.get("speed", "NORMAL")
                if speed_code == "JAM":
                    speeds.append(10.0)
                elif speed_code == "SLOW":
                    speeds.append(20.0)
                else:
                    speeds.append(35.0)
            if len(speeds) >= 2:
                speed_a = speeds[0]
                speed_b = speeds[1]
            elif len(speeds) == 1:
                speed_a = speeds[0]
                speed_b = speeds[0]

        # In case intervals are empty, compute speed proportional to delay ratio
        if not intervals and duration > 0:
            ratio = static_duration / duration
            speed_a = free_flow_speed * ratio
            speed_b = free_flow_speed * ratio

        # Heuristic estimates for queue counts andstopped ratios
        queue_a = max(0.0, delay / 15.0)
        queue_b = max(0.0, delay / 18.0)
        queue_growth = max(-10.0, min(20.0, (queue_a + queue_b) / 5.0))
        stopped_ratio_a = max(0.0, min(1.0, 1.0 - (speed_a / free_flow_speed)))
        stopped_ratio_b = max(0.0, min(1.0, 1.0 - (speed_b / free_flow_speed)))
        congestion_age = max(0.0, delay / 60.0)
        
        # Assemble feature dictionary matching the model schema
        # We need all 20 features
        obs = {
            "crossing_id": crossing_id,
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
            "route_static_duration_seconds": static_duration,
            "route_duration_seconds": duration,
            "traffic_delay_seconds": delay,
            "approach_a_speed_kph": speed_a,
            "approach_b_speed_kph": speed_b,
            "approach_a_speed_code": 2 if speed_a < 12 else 1 if speed_a < 25 else 0,
            "approach_b_speed_code": 2 if speed_b < 12 else 1 if speed_b < 25 else 0,
            "stopped_vehicle_ratio_a": stopped_ratio_a,
            "stopped_vehicle_ratio_b": stopped_ratio_b,
            "jam_segment_length_meters": (queue_a + queue_b) * 6.5,
            "queue_a_vehicles": queue_a,
            "queue_b_vehicles": queue_b,
            "queue_growth_vehicles_per_minute": queue_growth,
            "congestion_age_minutes": congestion_age,
            # Rolling features fallback to current for single observations
            "speed_a_rolling_3min": speed_a,
            "speed_b_rolling_3min": speed_b,
            "queue_growth_rolling_3min": queue_growth,
            "queue_growth_rolling_10min": queue_growth,
            "queue_acceleration": 0.0,
            "speed_trend_5min": 0.0,
        }
        return obs
    except Exception as e:
        print(f"Error querying Routes API for crossing {crossing_id}: {e}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crossings", type=Path, default=Path("data/crossings/jharkhand_pilot_level_crossings.json"))
    parser.add_argument("--api-key", type=str, required=True, help="Google Maps API Key")
    parser.add_argument("--output", type=Path, default=Path("data/realtime/routes_observations.csv"))
    parser.add_argument("--interval", type=int, default=300, help="Seconds to sleep between runs")
    parser.add_argument("--max-crossings", type=int, default=10, help="Max crossings to poll in a single run")
    args = parser.parse_args()

    if not args.crossings.exists():
        print(f"Crossings file not found: {args.crossings}")
        return

    crossing_payload = json.loads(args.crossings.read_text(encoding="utf-8"))
    crossings = crossing_payload.get("crossings", [])[:args.max_crossings]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    file_exists = args.output.exists()

    headers = [
        "crossing_id", "timestamp_utc", "route_static_duration_seconds", "route_duration_seconds",
        "traffic_delay_seconds", "approach_a_speed_kph", "approach_b_speed_kph",
        "approach_a_speed_code", "approach_b_speed_code", "stopped_vehicle_ratio_a",
        "stopped_vehicle_ratio_b", "jam_segment_length_meters", "queue_a_vehicles",
        "queue_b_vehicles", "queue_growth_vehicles_per_minute", "congestion_age_minutes",
        "speed_a_rolling_3min", "speed_b_rolling_3min", "queue_growth_rolling_3min",
        "queue_growth_rolling_10min", "queue_acceleration", "speed_trend_5min"
    ]

    print(f"Starting real-time traffic poller for {len(crossings)} crossings...")
    while True:
        observations = []
        for crossing in crossings:
            obs = poll_crossing_traffic(crossing, args.api_key)
            if obs:
                observations.append(obs)
                print(f"Successfully polled crossing {crossing['id']} - delay: {obs['traffic_delay_seconds']}s")
            time.sleep(1.0) # Rate limit requests
            
        if observations:
            with args.output.open("a", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=headers)
                if not file_exists:
                    writer.writeheader()
                    file_exists = True
                writer.writerows(observations)
            print(f"Wrote {len(observations)} observations to {args.output}")

        print(f"Sleeping for {args.interval} seconds...")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
