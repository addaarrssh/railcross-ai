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
    predicted_status: "OPEN" | "CLOSED" | "UNKNOWN";
    status_reason?: string;
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
};

type TrafficDemoSnapshot = {
  status: "OPEN" | "CLOSED";
  stoppedMinutes: number;
  trafficDelaySeconds: number;
  closedProbability: number;
  cyclePosition: number;
};

// "model": markers show the trained Python classifier's OPEN/CLOSED/UNKNOWN
// output for each crossing's synthetic traffic snapshot (from the exported
// predictions file). "demo": an animated 30-minute traffic cycle for demos.
type PredictionMode = "model" | "demo";

const DEMO_CYCLE_MINUTES = 30;

function stringHash(value: string): number {
  return Array.from(value).reduce((hash, character) => {
    return ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }, 0);
}

function getCycleMinute(date = new Date()): number {
  return Math.floor(date.getTime() / 60_000) % DEMO_CYCLE_MINUTES;
}

function createTrafficDemoSnapshot(groupId: string, cycleMinute: number): TrafficDemoSnapshot {
  const locationOffset = Math.abs(stringHash(groupId)) % DEMO_CYCLE_MINUTES;
  const cyclePosition = (cycleMinute + locationOffset) % DEMO_CYCLE_MINUTES;
  const variation = Math.abs(stringHash(`${groupId}-${cyclePosition}`)) % 24;

  if (cyclePosition >= 7 && cyclePosition <= 16) {
    const stoppedMinutes = cyclePosition - 6;
    return {
      status: "CLOSED",
      stoppedMinutes,
      trafficDelaySeconds: 70 + stoppedMinutes * 24 + variation,
      closedProbability: Math.min(0.97, 0.64 + stoppedMinutes * 0.03),
      cyclePosition,
    };
  }

  const clearingTraffic = cyclePosition >= 17 && cyclePosition <= 20;
  return {
    status: "OPEN",
    stoppedMinutes: 0,
    trafficDelaySeconds: clearingTraffic ? 80 - (cyclePosition - 17) * 15 + variation : 8 + variation,
    closedProbability: clearingTraffic ? 0.34 : 0.08,
    cyclePosition,
  };
}

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
      continue;
    }

    groups.push({
      id: crossing.id,
      lat: crossing.lat,
      lng: crossing.lng,
      district: crossing.district,
      crossings: [crossing],
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
  const [cycleMinute, setCycleMinute] = useState(() => getCycleMinute());
  const [predictionMode, setPredictionMode] = useState<PredictionMode>("model");
  const predictionModeRef = useRef<PredictionMode>("model");
  const applyPredictionModeRef = useRef<((mode: PredictionMode) => void) | null>(null);
  
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
    let trafficTimer: number | undefined;

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
        const applyPredictionState = (mode: PredictionMode, minute: number) => {
          crossingLayer.forEach((feature) => {
            if (mode === "demo") {
              const snapshot = createTrafficDemoSnapshot(String(feature.getProperty("group_id")), minute);
              feature.setProperty("predicted_status", snapshot.status);
              feature.setProperty("stopped_minutes", snapshot.stoppedMinutes);
              feature.setProperty("traffic_delay_seconds", snapshot.trafficDelaySeconds);
              feature.setProperty("closed_probability", snapshot.closedProbability);
              feature.setProperty("cycle_position", snapshot.cyclePosition);
            } else {
              feature.setProperty("predicted_status", feature.getProperty("model_status"));
              feature.setProperty("stopped_minutes", 0);
              feature.setProperty("traffic_delay_seconds", feature.getProperty("model_traffic_delay_seconds"));
              feature.setProperty("closed_probability", feature.getProperty("model_probability"));
              feature.setProperty("cycle_position", 0);
            }
          });
          setCycleMinute(minute);
        };
        applyPredictionModeRef.current = (mode) => applyPredictionState(mode, getCycleMinute());

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
                group_id: group.id,
                id: representativeCrossing.id,
                district: group.district,
                record_count: group.crossings.length,
                // Trained-model output for this crossing's exported snapshot.
                model_status: representativeCrossing.prediction.predicted_status,
                model_probability: representativeCrossing.prediction.closed_probability,
                model_minutes_until_open: representativeCrossing.prediction.predicted_minutes_until_open,
                model_traffic_delay_seconds: representativeCrossing.traffic_snapshot.traffic_delay_seconds,
                // Display properties, filled in by applyPredictionState below.
                predicted_status: representativeCrossing.prediction.predicted_status,
                stopped_minutes: 0,
                traffic_delay_seconds: representativeCrossing.traffic_snapshot.traffic_delay_seconds,
                closed_probability: representativeCrossing.prediction.closed_probability,
                cycle_position: 0,
              },
            };
          }),
        });

        crossingLayer.setStyle((feature) => {
          const status = feature.getProperty("predicted_status");
          const fillColor =
            status === "CLOSED" ? "#d93025" : status === "UNKNOWN" ? "#f9ab00" : "#188038";
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
          const crossingId = String(feature.getProperty("id"));
          const recordCount = Number(feature.getProperty("record_count"));
          const stoppedMinutes = Number(feature.getProperty("stopped_minutes"));
          const trafficDelaySeconds = Math.round(Number(feature.getProperty("traffic_delay_seconds")));

          const mode = predictionModeRef.current;
          const closedProbability = Number(feature.getProperty("closed_probability"));
          const minutesUntilOpen = Number(feature.getProperty("model_minutes_until_open"));
          const probabilityPercent = Math.round(closedProbability * 100);

          const popup = document.createElement("article");
          popup.className = "prediction-popup";
          const title = document.createElement("h2");
          title.textContent = "Railway crossing";
          const location = document.createElement("p");
          location.textContent = String(feature.getProperty("district"));
          const statusBadge = document.createElement("strong");
          statusBadge.className =
            status === "CLOSED"
              ? "prediction-closed"
              : status === "UNKNOWN"
                ? "prediction-unknown"
                : "prediction-open";
          statusBadge.textContent =
            status === "CLOSED"
              ? "Gate closed (prediction)"
              : status === "UNKNOWN"
                ? "Status unknown (model abstained)"
                : "Gate open (prediction)";
          const reason = document.createElement("p");
          if (mode === "model") {
            reason.textContent =
              status === "CLOSED"
                ? `The trained classifier gives a ${probabilityPercent}% closure probability${minutesUntilOpen > 0 ? ` and expects the gate to reopen in about ${minutesUntilOpen} minutes` : ""}.`
                : status === "UNKNOWN"
                  ? `The closure probability (${probabilityPercent}%) falls inside the model's uncertainty band, so it reports UNKNOWN instead of guessing.`
                  : `The trained classifier gives only a ${probabilityPercent}% closure probability, so the gate is predicted open.`;
          } else {
            reason.textContent =
              status === "CLOSED"
                ? `Cars have been stopped here for ${stoppedMinutes} minute${stoppedMinutes === 1 ? "" : "s"}. The model predicts that the gate is closed.`
                : "Cars are moving through this area. The model predicts that the gate is open.";
          }
          const traffic = document.createElement("p");
          traffic.textContent = `Traffic delay in this snapshot: about ${trafficDelaySeconds} seconds.`;
          const nextChange = document.createElement("p");
          if (mode === "demo") {
            nextChange.textContent =
              status === "CLOSED"
                ? "When the cars start moving in the next demo update, this prediction changes to gate open."
                : "If cars stay stopped for more than one minute, the next demo update can change this to gate closed.";
          } else {
            nextChange.textContent =
              "Switch to the demo cycle to watch how predictions change as simulated traffic builds and clears.";
          }
          const groupNote = document.createElement("p");
          groupNote.textContent =
            recordCount > 1 ? `This one dot represents ${recordCount} map records at the same crossing area.` : "";
              
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
          warning.textContent =
            mode === "model"
              ? "Model snapshot: the trained classifier scored a synthetic traffic snapshot for this crossing. It is not a live or verified gate status."
              : "Synthetic traffic demo: it updates every minute and repeats after 30 minutes. It is not a live or verified gate status.";
          popup.append(title, location, statusBadge, reason, traffic, nextChange);
          if (recordCount > 1) popup.append(groupNote);
          if (recordCount === 1) popup.append(reportSection);
          popup.append(warning);
          
          predictionWindow.setContent(popup);
          predictionWindow.setPosition(event.latLng);
          predictionWindow.open(map);
        });
        
        crossingLayerRef.current = crossingLayer;
        crossingBoundsRef.current = crossingBounds;
        setCrossingCount(crossingPayload.total);
        applyPredictionState(predictionModeRef.current, getCycleMinute());

        let previousMinute = getCycleMinute();
        trafficTimer = window.setInterval(() => {
          const nextMinute = getCycleMinute();
          if (nextMinute !== previousMinute) {
            previousMinute = nextMinute;
            if (predictionModeRef.current === "demo") {
              applyPredictionState("demo", nextMinute);
            }
          }
        }, 1_000);

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
      if (trafficTimer !== undefined) window.clearInterval(trafficTimer);
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

  function togglePredictionMode() {
    const nextMode: PredictionMode = predictionModeRef.current === "model" ? "demo" : "model";
    predictionModeRef.current = nextMode;
    setPredictionMode(nextMode);
    applyPredictionModeRef.current?.(nextMode);
  }

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
            {crossingsVisible ? "Hide" : "Show"} crossing predictions{crossingCount ? ` (${crossingCount})` : ""}
          </button>
          
          <button
            type="button"
            className="crossing-toggle"
            aria-pressed={predictionMode === "demo"}
            disabled={!crossingCount}
            onClick={togglePredictionMode}
            title="Model snapshot shows the trained classifier's OPEN/CLOSED/UNKNOWN output; demo cycle animates a synthetic 30-minute traffic pattern."
          >
            {predictionMode === "model" ? "🧠 Model snapshot" : "🔁 Demo cycle"}
          </button>

          <button type="button" className="location-btn" onClick={centerOnMyLocation}>
            📍 Locate Me
          </button>

          <Link href="/dashboard" className="dashboard-btn">
            📊 View Analytics
          </Link>
        </div>
      </section>

      <aside className="project-summary" aria-label="About RailCross">
        <p className="project-summary-kicker">RAILCROSS AI</p>
        <h1>Plan around railway-crossing delays</h1>
        <p>
          A late gate closure can create a queue and make commuters miss a route or appointment.
        </p>
        <div className="project-summary-step">
          <b>1. Watch traffic</b>
          <span>Cars stopped for longer can signal that a gate is closed.</span>
        </div>
        <div className="project-summary-step">
          <b>2. Predict the gate</b>
          <span>The model predicts open, closed, or unknown when it is not confident enough.</span>
        </div>
        <div className="project-summary-step">
          <b>3. Update the journey</b>
          <span>When cars move again, the prediction changes to open.</span>
        </div>
        <small>
          {predictionMode === "model"
            ? "Model snapshot mode: the trained classifier scored a synthetic traffic snapshot per crossing."
            : "Demo cycle mode: synthetic traffic that updates every minute and repeats after 30 minutes."}
        </small>
      </aside>

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
          <span><i className="legend-open" /> Gate open (prediction)</span>
          <span><i className="legend-closed" /> Gate closed (prediction)</span>
          <span><i className="legend-unknown" /> Status unknown (model abstained)</span>
          <small>
            {predictionMode === "model"
              ? "Trained-model snapshot on synthetic traffic features"
              : `Synthetic 30-minute traffic demo · minute ${cycleMinute + 1} of ${DEMO_CYCLE_MINUTES}`}
          </small>
          <small>{crossingCount} map records shown as {markerGroupCount} location markers</small>
        </aside>
      )}
      {error && <div className="map-error-message">{error}</div>}
    </main>
  );
}
