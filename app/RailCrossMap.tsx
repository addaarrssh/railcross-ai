"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import RouteComparison from "./RouteComparison";
import NotificationManager from "./NotificationManager";

declare global {
  interface Window {
    __railCrossGoogleMapsLoaded?: () => void;
  }
}

let googleMapsPromise: Promise<void> | null = null;

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
    approach_a_traffic: "NORMAL" | "SLOW" | "TRAFFIC_JAM";
    approach_b_traffic: "NORMAL" | "SLOW" | "TRAFFIC_JAM";
    traffic_delay_seconds: number;
    traffic_delay_change_1min_seconds: number;
    both_approaches_jammed_minutes: number;
  };
};

type CrossingMapPayload = {
  total: number;
  crossings: MapCrossing[];
};

type CrossingMarkerGroup = {
  id: string;
  lat: number;
  lng: number;
  district: string;
  crossings: MapCrossing[];
  predictedStatus: "OPEN" | "CLOSED" | "MIXED";
};

function distanceInMeters(
  first: Pick<MapCrossing, "lat" | "lng">,
  second: Pick<MapCrossing, "lat" | "lng">,
): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = ((second.lat - first.lat) * Math.PI) / 180;
  const longitudeDelta = ((second.lng - first.lng) * Math.PI) / 180;
  const latitudeRadians = (first.lat * Math.PI) / 180;
  const secondLatitudeRadians = (second.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function groupNearbyCrossings(crossings: MapCrossing[], radiusMeters = 45): CrossingMarkerGroup[] {
  const groups: CrossingMarkerGroup[] = [];

  for (const crossing of crossings) {
    const nearbyGroup = groups.find((group) =>
      distanceInMeters(crossing, group) <= radiusMeters,
    );

    if (nearbyGroup) {
      nearbyGroup.crossings.push(crossing);
      nearbyGroup.lat =
        nearbyGroup.crossings.reduce((sum, item) => sum + item.lat, 0) /
        nearbyGroup.crossings.length;
      nearbyGroup.lng =
        nearbyGroup.crossings.reduce((sum, item) => sum + item.lng, 0) /
        nearbyGroup.crossings.length;
      nearbyGroup.predictedStatus =
        new Set(nearbyGroup.crossings.map((item) => item.prediction.predicted_status)).size > 1
          ? "MIXED"
          : nearbyGroup.crossings[0].prediction.predicted_status;
      continue;
    }

    groups.push({
      id: crossing.id,
      lat: crossing.lat,
      lng: crossing.lng,
      district: crossing.district,
      crossings: [crossing],
      predictedStatus: crossing.prediction.predicted_status,
    });
  }

  return groups;
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    window.__railCrossGoogleMapsLoaded = resolve;

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=__railCrossGoogleMapsLoaded&v=weekly&auth_referrer_policy=origin&libraries=geometry`;
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
  const [crossings, setCrossings] = useState<MapCrossing[]>([]);
  const [crossingCount, setCrossingCount] = useState(0);
  const [markerGroupCount, setMarkerGroupCount] = useState(0);
  const [crossingsVisible, setCrossingsVisible] = useState(false);
  
  const [origin, setOrigin] = useState<google.maps.LatLng | null>(null);
  const [destination, setDestination] = useState<google.maps.LatLng | null>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  async function submitReport(crossingId: string, status: "OPEN" | "CLOSED") {
    if (!navigator.geolocation) {
      alert("Geolocation is required to submit a verification report.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ crossingId, status, latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          });
          const data = await res.json();
          alert(res.ok ? `Thanks! Your report for node ${crossingId} was submitted.` : `Error: ${data.error}`);
        } catch {
          alert("Failed to submit report. Please try again.");
        }
      },
      () => alert("Failed to get your location. Proximity check requires GPS.")
    );
  }

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
        setMapInstance(map);

        const crossingResponse = await fetch("/jharkhand_crossing_predictions.json");
        if (!crossingResponse.ok) throw new Error("Railway-crossing locations could not be loaded.");
        const crossingPayload = (await crossingResponse.json()) as CrossingMapPayload;
        if (cancelled) return;

        const crossingRecords = crossingPayload.crossings || [];
        const markerGroups = groupNearbyCrossings(crossingRecords);
        setCrossings(crossingRecords);
        setMarkerGroupCount(markerGroups.length);

        const crossingLayer = new google.maps.Data();
        const crossingBounds = new google.maps.LatLngBounds();
        crossingLayer.addGeoJson({
          type: "FeatureCollection",
          features: markerGroups.map((group) => {
            const [representativeCrossing] = group.crossings;
            crossingBounds.extend({ lat: group.lat, lng: group.lng });
            return {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [group.lng, group.lat],
              },
              properties: {
                id: representativeCrossing.id,
                district: group.district,
                osm_node_ids: group.crossings.map((item) => item.osm_node_id).join(", "),
                record_count: group.crossings.length,
                predicted_status: group.predictedStatus,
                closed_probability: representativeCrossing.prediction.closed_probability,
                predicted_minutes_until_open:
                  representativeCrossing.prediction.predicted_minutes_until_open,
                approach_a_traffic: representativeCrossing.traffic_snapshot.approach_a_traffic,
                approach_b_traffic: representativeCrossing.traffic_snapshot.approach_b_traffic,
                traffic_delay_seconds: representativeCrossing.traffic_snapshot.traffic_delay_seconds,
                traffic_delay_change_1min_seconds:
                  representativeCrossing.traffic_snapshot.traffic_delay_change_1min_seconds,
                both_approaches_jammed_minutes:
                  representativeCrossing.traffic_snapshot.both_approaches_jammed_minutes,
              },
            };
          }),
        });
        
        crossingLayer.setStyle((feature) => {
          const status = feature.getProperty("predicted_status");
          const fillColor =
            status === "MIXED" ? "#f9ab00" : status === "CLOSED" ? "#d93025" : "#188038";
          return {
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 6,
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
          const crossingId = String(feature.getProperty("id"));
          const recordCount = Number(feature.getProperty("record_count"));

          const popup = document.createElement("article");
          popup.className = "prediction-popup";
          const title = document.createElement("h2");
          title.textContent =
            recordCount > 1
              ? `Railway crossing area (${recordCount} mapped records)`
              : `Railway crossing ${feature.getProperty("osm_node_ids")}`;
          const location = document.createElement("p");
          location.textContent = String(feature.getProperty("district"));
          const statusBadge = document.createElement("strong");
          statusBadge.className =
            status === "MIXED"
              ? "prediction-mixed"
              : status === "CLOSED"
                ? "prediction-closed"
                : "prediction-open";
          statusBadge.textContent =
            status === "MIXED"
              ? "Nearby records have mixed demo predictions"
              : `Model predicts ${status}`;
          const confidence = document.createElement("p");
          confidence.textContent =
            status === "MIXED"
              ? "The map groups records within 45 m to avoid showing conflicting colours at one location."
              : `${Math.round(probability * 100)}% predicted probability of closure`;
          const traffic = document.createElement("p");
          traffic.textContent = `Google Routes traffic classes: approach A ${feature.getProperty("approach_a_traffic")} · approach B ${feature.getProperty("approach_b_traffic")}`;
          const trafficHistory = document.createElement("p");
          trafficHistory.textContent = `Traffic delay: ${feature.getProperty("traffic_delay_seconds")} seconds · change in one minute: ${feature.getProperty("traffic_delay_change_1min_seconds")} seconds · both approaches jammed for ${feature.getProperty("both_approaches_jammed_minutes")} minutes`;
          
          const reopening = document.createElement("p");
          reopening.textContent =
            status === "CLOSED"
              ? `Estimated reopening: ${minutesUntilOpen.toFixed(1)} minutes`
              : status === "MIXED"
                ? "Open one of the nearby mapped crossings to verify its actual status."
                : "No crossing delay predicted";
              
          // Gate report section
          const reportSection = document.createElement("div");
          reportSection.className = "gate-report-section";
          if (recordCount === 1) {
            const reportLabel = document.createElement("span");
            reportLabel.textContent = "Report actual status:";
            const openBtn = document.createElement("button");
            openBtn.className = "gate-report-btn-open";
            openBtn.textContent = "🟢 Open";
            openBtn.onclick = () => submitReport(crossingId, "OPEN");
            const closedBtn = document.createElement("button");
            closedBtn.className = "gate-report-btn-closed";
            closedBtn.textContent = "🔴 Closed";
            closedBtn.onclick = () => submitReport(crossingId, "CLOSED");
            reportSection.append(reportLabel, openBtn, closedBtn);
          }

          const warning = document.createElement("small");
          warning.textContent = "Synthetic model demonstration — not live Google traffic or a verified gate state.";
          popup.append(title, location, statusBadge, confidence, traffic, trafficHistory, reopening);
          if (recordCount === 1) popup.append(reportSection);
          popup.append(warning);
          
          predictionWindow.setContent(popup);
          predictionWindow.setPosition(event.latLng);
          predictionWindow.open(map);
        });
        
        crossingLayerRef.current = crossingLayer;
        crossingBoundsRef.current = crossingBounds;
        setCrossingCount(crossingPayload.total);

        const { PlaceAutocompleteElement } = (await google.maps.importLibrary(
          "places"
        )) as google.maps.PlacesLibrary;

        if (cancelled || !originSearchRef.current || !destinationSearchRef.current) return;

        const createLocationSearch = (placeholder: string, onSelect: (loc: google.maps.LatLng | null) => void) => {
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
            onSelect(place.location || null);
          });

          return autocomplete;
        };

        const originSearch = createLocationSearch("Choose starting location", (loc) => setOrigin(loc));
        const destinationSearch = createLocationSearch("Choose destination", (loc) => setDestination(loc));
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
      setMapInstance(null);
    };
  }, [apiKey]);

  const centerOnMyLocation = () => {
    if (navigator.geolocation && mapInstanceRef.current) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = new google.maps.LatLng(position.coords.latitude, position.coords.longitude);
          mapInstanceRef.current?.setCenter(pos);
          mapInstanceRef.current?.setZoom(15);
          
          new google.maps.Marker({
            position: pos,
            map: mapInstanceRef.current!,
            title: "Your Location",
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#1a73e8",
              fillOpacity: 1,
              strokeColor: "white",
              strokeWeight: 2,
            },
          });
        },
        () => {
          setError("Geolocation permission denied or failed.");
        }
      );
    }
  };

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
        <div className="search-buttons-row">
          <button
            type="button"
            className="crossing-toggle"
            aria-pressed={crossingsVisible}
            disabled={!crossingCount}
            onClick={toggleCrossings}
          >
            {crossingsVisible ? "Hide" : "Show"} railway crossings{crossingCount ? ` (${crossingCount})` : ""}
          </button>
          
          <button type="button" className="location-btn" onClick={centerOnMyLocation}>
            📍 Locate Me
          </button>

          <Link href="/dashboard" className="dashboard-btn">
            📊 View Analytics
          </Link>
        </div>
      </section>

      {/* Render Route Comparison overlay */}
      <RouteComparison
        map={mapInstance}
        crossings={crossings}
        origin={origin}
        destination={destination}
      />

      {/* Render Push Alert settings */}
      <NotificationManager crossings={crossings} />

      {crossingsVisible && (
        <aside className="prediction-legend" aria-label="Model prediction legend">
          <span><i className="legend-open" /> Predicted open</span>
          <span><i className="legend-closed" /> Predicted closed</span>
          <span><i className="legend-mixed" /> Nearby records disagree</span>
          <small>{crossingCount} mapped records shown as {markerGroupCount} location markers</small>
        </aside>
      )}
      {error && <div className="map-error-message">{error}</div>}
    </main>
  );
}
