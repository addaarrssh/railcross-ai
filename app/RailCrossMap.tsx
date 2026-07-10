"use client";

import { useEffect, useRef, useState } from "react";

type Prediction = {
  predicted_status: "OPEN" | "CLOSED" | "UNGATED";
  closed_probability: number | null;
  predicted_minutes_until_open: number;
  benchmark_scope: string;
};

type Crossing = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  barrier: "full" | "unknown" | "no";
  osm_node_id: number;
  prediction: Prediction;
  prediction_source: string;
};

type CrossingPayload = {
  mode: string;
  model_evaluation: {
    f1: number;
    precision: number;
    recall: number;
    reopening_mae_minutes: number;
    scope: string;
  };
  crossings: Crossing[];
};

declare global {
  interface Window {
    __railCrossGoogleMapsLoaded?: () => void;
  }
}

let googleMapsPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;
  googleMapsPromise = new Promise((resolve, reject) => {
    window.__railCrossGoogleMapsLoaded = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=__railCrossGoogleMapsLoaded&v=weekly&libraries=marker&auth_referrer_policy=origin`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps could not be loaded."));
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

function statusColor(status: Prediction["predicted_status"]) {
  if (status === "CLOSED") return "#d93025";
  if (status === "OPEN") return "#188038";
  return "#6b7280";
}

function popupContent(crossing: Crossing, metrics: CrossingPayload["model_evaluation"]) {
  const root = document.createElement("article");
  root.className = "railcross-popup";

  const eyebrow = document.createElement("div");
  eyebrow.className = "popup-eyebrow";
  eyebrow.textContent = crossing.barrier === "full" ? "Verified full gate" : crossing.barrier === "no" ? "Ungated crossing" : "Gate type needs field verification";

  const title = document.createElement("h2");
  title.textContent = crossing.name;

  const status = document.createElement("div");
  status.className = `popup-status status-${crossing.prediction.predicted_status.toLowerCase()}`;
  status.textContent = crossing.prediction.predicted_status === "UNGATED"
    ? "No gate prediction"
    : `Model predicts ${crossing.prediction.predicted_status}`;

  const confidence = document.createElement("p");
  if (crossing.prediction.closed_probability === null) {
    confidence.textContent = "This OpenStreetMap point is tagged as an ungated level crossing.";
  } else {
    const percentage = Math.round(crossing.prediction.closed_probability * 100);
    confidence.textContent = `${percentage}% probability of closure`;
  }

  const wait = document.createElement("p");
  wait.className = "popup-wait";
  wait.textContent = crossing.prediction.predicted_status === "CLOSED"
    ? `Estimated reopening: ${crossing.prediction.predicted_minutes_until_open.toFixed(1)} minutes`
    : crossing.prediction.predicted_status === "OPEN"
      ? "Estimated crossing delay: none"
      : "Gate timing is not applicable";

  const divider = document.createElement("hr");
  const source = document.createElement("p");
  source.className = "popup-source";
  source.textContent = `Model benchmark: ${(metrics.f1 * 100).toFixed(1)}% F1 on held-out synthetic events. This popup is a model demo, not a live railway confirmation.`;

  const future = document.createElement("div");
  future.className = "future-idea";
  future.textContent = "Proposed next feature: ask nearby users to confirm whether the gate is open or closed.";

  root.append(eyebrow, title, status, confidence, wait, divider, source, future);
  return root;
}

export default function RailCrossMap({ apiKey }: { apiKey: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(Boolean(apiKey));
  const [error, setError] = useState("");
  const [markerCount, setMarkerCount] = useState(0);

  useEffect(() => {
    if (!apiKey || !mapRef.current) return;
    let cancelled = false;

    async function initializeMap() {
      try {
        const [payloadResponse] = await Promise.all([
          fetch("/crossings.json"),
          loadGoogleMaps(apiKey),
        ]);
        if (!payloadResponse.ok) throw new Error("Crossing points could not be loaded.");
        const payload = await payloadResponse.json() as CrossingPayload;
        if (cancelled || !mapRef.current) return;

        const map = new google.maps.Map(mapRef.current, {
          center: { lat: 22.7818, lng: 86.1535 },
          zoom: 12,
          mapId: "DEMO_MAP_ID",
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          clickableIcons: true,
        });
        const infoWindow = new google.maps.InfoWindow({ maxWidth: 340 });
        const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

        payload.crossings.forEach((crossing) => {
          const pin = new PinElement({
            background: statusColor(crossing.prediction.predicted_status),
            borderColor: "#ffffff",
            glyphColor: "#ffffff",
            glyphText: "✕",
            scale: 0.92,
          });
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: crossing.lat, lng: crossing.lng },
            title: `${crossing.name}: ${crossing.prediction.predicted_status}`,
            gmpClickable: true,
            content: pin,
          });
          const openPopup = () => {
            infoWindow.setContent(popupContent(crossing, payload.model_evaluation));
            infoWindow.open({ map, anchor: marker, shouldFocus: false });
          };
          marker.addEventListener("gmp-click", openPopup);
          pin.addEventListener("mouseenter", openPopup);
        });

        setMarkerCount(payload.crossings.length);
        setLoading(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The map could not be loaded.");
        setLoading(false);
      }
    }

    void initializeMap();
    return () => { cancelled = true; };
  }, [apiKey]);

  if (!apiKey) {
    return (
      <main className="map-setup">
        <section className="setup-card">
          <div className="setup-brand"><span className="brand-dot" /> RailCross</div>
          <span className="setup-kicker">Google Maps integration ready</span>
          <h1>Add a restricted Maps API key to activate the real map.</h1>
          <p>The prediction engine and 18 pilot railway-crossing points are ready. The project deliberately keeps the billing-enabled Google credential outside the repository.</p>
          <div className="setup-command"><span>Environment variable</span><code>GOOGLE_MAPS_API_KEY</code></div>
          <p className="setup-note">Enable the Maps JavaScript API and restrict the key to this website’s HTTPS domain.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="real-map-shell">
      <div ref={mapRef} className="google-map" aria-label="Google Map showing RailCross railway-crossing markers" />
      <header className="map-brand-card">
        <div className="map-brand"><span className="brand-dot" /> RailCross</div>
        <p>Railway-crossing predictions</p>
        <span>{markerCount || "…"} pilot points · Jamshedpur</span>
      </header>
      <aside className="model-badge">
        <strong>Model-first prototype</strong>
        <span>94.4% F1 on synthetic holdout</span>
        <small>Click a crossing marker for the prediction</small>
      </aside>
      <div className="map-attribution">Crossing points © OpenStreetMap contributors · Predictions are synthetic model demonstrations</div>
      {loading && <div className="map-message">Loading Google Maps and crossing points…</div>}
      {error && <div className="map-message map-error">{error}</div>}
    </main>
  );
}

