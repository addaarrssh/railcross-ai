"use client";

import { useEffect, useState, useRef } from "react";

type MapCrossing = {
  id: string;
  osm_node_id: number;
  district: string;
  lat: number;
  lng: number;
  barrier: string | null;
  prediction: {
    predicted_status: "OPEN" | "CLOSED";
    closed_probability: number;
    predicted_minutes_until_open: number;
    benchmark_scope: "synthetic" | "realtime";
  };
  traffic_snapshot: {
    approach_a_speed_kph: number;
    approach_b_speed_kph: number;
    queue_a_vehicles: number;
    queue_b_vehicles: number;
  };
};

type RouteOption = {
  summary: string;
  durationText: string;
  durationSeconds: number;
  adjustedDurationSeconds: number;
  crossings: MapCrossing[];
  polyline: string;
  hasClosedCrossing: boolean;
  hasWarningCrossing: boolean;
};

type RouteComparisonProps = {
  map: google.maps.Map | null;
  crossings: MapCrossing[];
  origin: google.maps.LatLng | null;
  destination: google.maps.LatLng | null;
};

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function RouteComparison({ map, crossings, origin, destination }: RouteComparisonProps) {
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const directionsRenderersRef = useRef<google.maps.DirectionsRenderer[]>([]);

  useEffect(() => {
    if (!map || !origin || !destination || crossings.length === 0) {
      // Clear previous routes if inputs are removed
      // eslint-disable-next-line react-hooks/immutability
      clearRoutes();
      return;
    }

    queueMicrotask(() => setLoading(true));
    const directionsService = new google.maps.DirectionsService();

    directionsService.route(
      {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: true,
      },
      (result, status) => {
        setLoading(false);
        if (status === google.maps.DirectionsStatus.OK && result && result.routes) {
          // eslint-disable-next-line react-hooks/immutability
          processRoutes(result.routes);
        } else {
          console.error("Directions request failed:", status);
        }
      }
    );

    return () => {
      clearRoutes();
    };
  // The Maps API callback needs current inputs; the helper is recreated with component state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, origin, destination, crossings]);

  useEffect(() => {
    // Redraw selected route overlay
    if (!map || routes.length === 0) return;

    // Clear existing renderers
    directionsRenderersRef.current.forEach((r) => r.setMap(null));
    directionsRenderersRef.current = [];

    routes.forEach((route, idx) => {
      const isSelected = idx === selectedRouteIndex;
      const strokeColor = route.hasClosedCrossing
        ? "#d93025" // Red
        : route.hasWarningCrossing
        ? "#f9ab00" // Yellow
        : "#1a73e8"; // Blue

      const renderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: false,
        polylineOptions: {
          strokeColor,
          strokeWeight: isSelected ? 6 : 3,
          strokeOpacity: isSelected ? 0.9 : 0.4,
          zIndex: isSelected ? 100 : 10,
        },
      });

      // Decode path
      const path = google.maps.geometry.encoding.decodePath(route.polyline);
      const mockResult = {
        routes: [
          {
            overview_path: path,
            legs: [
              {
                start_location: origin,
                end_location: destination,
                steps: [],
              },
            ],
          },
        ],
      } as unknown as google.maps.DirectionsResult;
      
      renderer.setDirections(mockResult);
      directionsRenderersRef.current.push(renderer);
    });
  }, [map, routes, selectedRouteIndex, origin, destination]);

  function clearRoutes() {
    setRoutes([]);
    directionsRenderersRef.current.forEach((r) => r.setMap(null));
    directionsRenderersRef.current = [];
  }

  function processRoutes(googleRoutes: google.maps.DirectionsRoute[]) {
    const options: RouteOption[] = googleRoutes.map((gRoute) => {
      const leg = gRoute.legs[0];
      const durationSeconds = leg.duration ? leg.duration.value : 0;
      const overviewPath = gRoute.overview_path;

      // Find crossings within 100m of route polyline
      const matchedCrossings = crossings.filter((crossing) => {
        return overviewPath.some((point) => {
          return haversineMeters(crossing.lat, crossing.lng, point.lat(), point.lng()) < 100;
        });
      });

      // Calculate delay adjustments
      let totalDelaySeconds = 0;
      let hasClosedCrossing = false;
      let hasWarningCrossing = false;

      matchedCrossings.forEach((c) => {
        if (c.prediction.predicted_status === "CLOSED") {
          hasClosedCrossing = true;
          totalDelaySeconds += c.prediction.predicted_minutes_until_open * 60;
        } else if (c.prediction.closed_probability > 0.4) {
          hasWarningCrossing = true;
          totalDelaySeconds += 120; // assumed caution delay
        }
      });

      // Encode polyline for storage
      const polyline = google.maps.geometry.encoding.encodePath(overviewPath);

      return {
        summary: gRoute.summary || "Alternative Route",
        durationText: leg.duration ? leg.duration.text : "N/A",
        durationSeconds,
        adjustedDurationSeconds: durationSeconds + totalDelaySeconds,
        crossings: matchedCrossings,
        polyline,
        hasClosedCrossing,
        hasWarningCrossing,
      };
    });

    // Sort so safest/fastest routes are shown first
    options.sort((a, b) => a.adjustedDurationSeconds - b.adjustedDurationSeconds);
    setRoutes(options);
    setSelectedRouteIndex(0);
  }

  if (!origin || !destination) return null;

  return (
    <section className="route-panel" aria-label="Route options comparison">
      {loading ? (
        <div className="route-loading">Analyzing routes for railway crossings...</div>
      ) : routes.length === 0 ? (
        <div className="route-empty">No alternative routes found.</div>
      ) : (
        <div className="route-list">
          <h3>Alternative Commute Routes</h3>
          <div className="route-cards-container">
            {routes.map((route, idx) => {
              const isSelected = idx === selectedRouteIndex;
              const delayMins = Math.round((route.adjustedDurationSeconds - route.durationSeconds) / 60);

              let badgeClass = "route-badge-safe";
              let badgeText = "Safe Route";
              if (route.hasClosedCrossing) {
                badgeClass = "route-badge-danger";
                badgeText = "Closed Crossings";
              } else if (route.hasWarningCrossing) {
                badgeClass = "route-badge-warning";
                badgeText = "Caution Jams";
              }

              return (
                <article
                  key={idx}
                  className={`route-card ${isSelected ? "route-card-selected" : ""}`}
                  onClick={() => setSelectedRouteIndex(idx)}
                >
                  <header className="route-card-header">
                    <h4>via {route.summary}</h4>
                    <span className={`route-badge ${badgeClass}`}>{badgeText}</span>
                  </header>
                  <p className="route-card-time">
                    <strong>{Math.round(route.adjustedDurationSeconds / 60)} min</strong>
                    {delayMins > 0 && <span className="route-delay-text"> (+{delayMins} min gate delay)</span>}
                  </p>
                  <footer className="route-card-footer">
                    <span>{route.crossings.length} railway crossings on route</span>
                    {isSelected && (
                      <button
                        className="route-navigate-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat()},${origin.lng()}&destination=${destination.lat()},${destination.lng()}&travelmode=driving`;
                          window.open(url, "_blank");
                        }}
                      >
                        Navigate
                      </button>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
