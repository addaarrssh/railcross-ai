"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    __railCrossGoogleMapsLoaded?: () => void;
  }
}

let googleMapsPromise: Promise<void> | null = null;

type MapCrossing = {
  id: string;
  osm_node_id: number;
  district: "Latehar" | "Ranchi" | "East Singhbhum";
  lat: number;
  lng: number;
  barrier: string | null;
  prediction: {
    predicted_status: "OPEN" | "CLOSED";
    closed_probability: number;
    predicted_minutes_until_open: number;
    benchmark_scope: "synthetic";
  };
  traffic_snapshot: {
    approach_a_speed_kph: number;
    approach_b_speed_kph: number;
    approach_a_movement: "MOVING" | "SLOW" | "STOPPED";
    approach_b_movement: "MOVING" | "SLOW" | "STOPPED";
    stopped_vehicle_ratio_a: number;
    stopped_vehicle_ratio_b: number;
    queue_a_vehicles: number;
    queue_b_vehicles: number;
    queue_growth_vehicles_per_minute: number;
    traffic_delay_seconds: number;
    congestion_age_minutes: number;
  };
};

type CrossingMapPayload = {
  total: number;
  crossings: MapCrossing[];
};

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    window.__railCrossGoogleMapsLoaded = resolve;

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=__railCrossGoogleMapsLoaded&v=weekly&auth_referrer_policy=origin`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps could not be loaded."));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

export default function RailCrossMap({ apiKey }: { apiKey: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const originSearchRef = useRef<HTMLDivElement>(null);
  const destinationSearchRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const crossingLayerRef = useRef<google.maps.Data | null>(null);
  const crossingBoundsRef = useRef<google.maps.LatLngBounds | null>(null);
  const [error, setError] = useState("");
  const [crossingCount, setCrossingCount] = useState(0);
  const [crossingsVisible, setCrossingsVisible] = useState(false);

  useEffect(() => {
    if (!apiKey || !mapRef.current) return;
    let cancelled = false;

    async function initializeMap() {
      try {
        await loadGoogleMaps(apiKey);
        if (cancelled || !mapRef.current) return;

        const map = new google.maps.Map(mapRef.current, {
          center: { lat: 22.8046, lng: 86.2029 },
          zoom: 13,
          disableDefaultUI: false,
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          clickableIcons: true,
        });
        mapInstanceRef.current = map;

        const crossingResponse = await fetch("/jharkhand_crossing_predictions.json");
        if (!crossingResponse.ok) throw new Error("Railway-crossing locations could not be loaded.");
        const crossingPayload = await crossingResponse.json() as CrossingMapPayload;
        if (cancelled) return;

        const crossingLayer = new google.maps.Data();
        const crossingBounds = new google.maps.LatLngBounds();
        crossingLayer.addGeoJson({
          type: "FeatureCollection",
          features: crossingPayload.crossings.map((crossing) => {
            crossingBounds.extend({ lat: crossing.lat, lng: crossing.lng });
            return {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [crossing.lng, crossing.lat],
              },
              properties: {
                id: crossing.id,
                district: crossing.district,
                osm_node_id: crossing.osm_node_id,
                barrier: crossing.barrier,
                predicted_status: crossing.prediction.predicted_status,
                closed_probability: crossing.prediction.closed_probability,
                predicted_minutes_until_open: crossing.prediction.predicted_minutes_until_open,
                approach_a_speed_kph: crossing.traffic_snapshot.approach_a_speed_kph,
                approach_b_speed_kph: crossing.traffic_snapshot.approach_b_speed_kph,
                approach_a_movement: crossing.traffic_snapshot.approach_a_movement,
                approach_b_movement: crossing.traffic_snapshot.approach_b_movement,
                queue_a_vehicles: crossing.traffic_snapshot.queue_a_vehicles,
                queue_b_vehicles: crossing.traffic_snapshot.queue_b_vehicles,
                queue_growth: crossing.traffic_snapshot.queue_growth_vehicles_per_minute,
                congestion_age_minutes: crossing.traffic_snapshot.congestion_age_minutes,
              },
            };
          }),
        });
        crossingLayer.setStyle((feature) => {
          const status = feature.getProperty("predicted_status");
          const fillColor = status === "CLOSED" ? "#d93025" : "#188038";
          return {
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 5,
              fillColor,
              fillOpacity: 0.95,
              strokeColor: "#ffffff",
              strokeWeight: 1.5,
            },
          };
        });
        const predictionWindow = new google.maps.InfoWindow({ maxWidth: 340 });
        crossingLayer.addListener("click", (event: google.maps.Data.MouseEvent) => {
          const feature = event.feature;
          const status = String(feature.getProperty("predicted_status"));
          const probability = Number(feature.getProperty("closed_probability"));
          const minutesUntilOpen = Number(feature.getProperty("predicted_minutes_until_open"));

          const popup = document.createElement("article");
          popup.className = "prediction-popup";
          const title = document.createElement("h2");
          title.textContent = `Railway crossing ${feature.getProperty("osm_node_id")}`;
          const location = document.createElement("p");
          location.textContent = String(feature.getProperty("district"));
          const statusBadge = document.createElement("strong");
          statusBadge.className = status === "CLOSED" ? "prediction-closed" : "prediction-open";
          statusBadge.textContent = `Model predicts ${status}`;
          const confidence = document.createElement("p");
          confidence.textContent = `${Math.round(probability * 100)}% predicted probability of closure`;
          const traffic = document.createElement("p");
          traffic.textContent = `Approach traffic: ${feature.getProperty("approach_a_movement")} at ${feature.getProperty("approach_a_speed_kph")} km/h · ${feature.getProperty("approach_b_movement")} at ${feature.getProperty("approach_b_speed_kph")} km/h`;
          const queue = document.createElement("p");
          queue.textContent = `Estimated queues: ${feature.getProperty("queue_a_vehicles")} + ${feature.getProperty("queue_b_vehicles")} vehicles · growth ${feature.getProperty("queue_growth")} vehicles/min`;
          const reopening = document.createElement("p");
          reopening.textContent = status === "CLOSED"
            ? `Estimated reopening: ${minutesUntilOpen.toFixed(1)} minutes`
            : "No crossing delay predicted";
          const warning = document.createElement("small");
          warning.textContent = "Synthetic model demonstration — not live Google traffic or a verified gate state.";
          popup.append(title, location, statusBadge, confidence, traffic, queue, reopening, warning);
          predictionWindow.setContent(popup);
          predictionWindow.setPosition(event.latLng);
          predictionWindow.open(map);
        });
        crossingLayerRef.current = crossingLayer;
        crossingBoundsRef.current = crossingBounds;
        setCrossingCount(crossingPayload.total);

        const { PlaceAutocompleteElement } = await google.maps.importLibrary(
          "places",
        ) as google.maps.PlacesLibrary;

        if (cancelled || !originSearchRef.current || !destinationSearchRef.current) return;

        const createLocationSearch = (placeholder: string) => {
          const autocomplete = new PlaceAutocompleteElement();
          autocomplete.placeholder = placeholder;
          autocomplete.includedRegionCodes = ["in"];
          autocomplete.locationBias = {
            center: { lat: 23.6102, lng: 85.2799 },
            radius: 50_000,
          };

          autocomplete.addEventListener("gmp-select", async (event: Event) => {
            const selection = event as Event & {
              placePrediction: google.maps.places.PlacePrediction;
            };
            const place = selection.placePrediction.toPlace();
            await place.fetchFields({ fields: ["displayName", "formattedAddress", "location", "viewport"] });
            if (cancelled) return;

            if (place.viewport) {
              map.fitBounds(place.viewport);
            } else if (place.location) {
              map.setCenter(place.location);
              map.setZoom(16);
            }
          });

          return autocomplete;
        };

        const originSearch = createLocationSearch("Choose starting location");
        const destinationSearch = createLocationSearch("Choose destination");
        originSearchRef.current.replaceChildren(originSearch);
        destinationSearchRef.current.replaceChildren(destinationSearch);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Google Maps could not be loaded.");
      }
    }

    void initializeMap();
    return () => {
      cancelled = true;
      crossingLayerRef.current?.setMap(null);
      crossingLayerRef.current = null;
      mapInstanceRef.current = null;
    };
  }, [apiKey]);

  function toggleCrossings() {
    const map = mapInstanceRef.current;
    const layer = crossingLayerRef.current;
    if (!map || !layer) return;

    const nextVisible = !crossingsVisible;
    layer.setMap(nextVisible ? map : null);
    if (nextVisible && crossingBoundsRef.current) {
      map.fitBounds(crossingBoundsRef.current, 40);
    }
    setCrossingsVisible(nextVisible);
  }

  if (!apiKey) {
    return <main className="map-error-page">A Google Maps API key is required.</main>;
  }

  return (
    <main className="google-map-page">
      <div ref={mapRef} className="google-map" aria-label="Google Map centered on Jamshedpur" />
      <section className="route-search" aria-label="Find locations">
        <label>
          <span>From</span>
          <div ref={originSearchRef} className="place-search-slot" />
        </label>
        <label>
          <span>To</span>
          <div ref={destinationSearchRef} className="place-search-slot" />
        </label>
        <button
          type="button"
          className="crossing-toggle"
          aria-pressed={crossingsVisible}
          disabled={!crossingCount}
          onClick={toggleCrossings}
        >
          {crossingsVisible ? "Hide" : "Show"} railway crossings{crossingCount ? ` (${crossingCount})` : ""}
        </button>
      </section>
      {crossingsVisible && (
        <aside className="prediction-legend" aria-label="Model prediction legend">
          <span><i className="legend-open" /> Predicted open</span>
          <span><i className="legend-closed" /> Predicted closed</span>
          <small>Synthetic traffic model demo</small>
        </aside>
      )}
      {error && <div className="map-error-message">{error}</div>}
    </main>
  );
}
