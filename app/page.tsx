"use client";

import { useMemo, useState } from "react";

type Scenario = "closure" | "reopening" | "clear";

const scenarioCopy = {
  closure: { status: "Closed", statusTone: "danger", confidence: 92, wait: "8–11 min", arrivalRisk: 84, traffic: "Queue expanding on both approaches", reason: "Community reports and the congestion wave agree that the gate is closed.", bestRoute: "via Kharkai Bridge", liveLabel: "Gate closure detected" },
  reopening: { status: "Reopening", statusTone: "warning", confidence: 78, wait: "3–5 min", arrivalRisk: 48, traffic: "Gate likely open; queue is clearing", reason: "Trusted observers report an opening event. Traffic has not fully cleared yet.", bestRoute: "via Kharkai Bridge", liveLabel: "Queue clearance detected" },
  clear: { status: "Open", statusTone: "success", confidence: 89, wait: "0 min", arrivalRisk: 19, traffic: "Approach roads are moving normally", reason: "Traffic flow and nearby reports show no current crossing delay.", bestRoute: "via Adityapur Road", liveLabel: "Normal flow confirmed" },
} as const;

const initialRoutes = [
  { id: "crossing", name: "Adityapur Road", base: 18, distance: "8.4 km", className: "route-primary" },
  { id: "bridge", name: "Kharkai Bridge", base: 23, distance: "10.1 km", className: "route-alternate" },
];

export default function Home() {
  const [scenario, setScenario] = useState<Scenario>("closure");
  const [selectedRoute, setSelectedRoute] = useState("bridge");
  const [closedVotes, setClosedVotes] = useState(7);
  const [openVotes, setOpenVotes] = useState(1);
  const [toast, setToast] = useState("Live demo signals are active.");
  const [routeStarted, setRouteStarted] = useState(false);

  const data = scenarioCopy[scenario];
  const reports = closedVotes + openVotes;
  const communityConfidence = Math.round((closedVotes / reports) * 100);
  const crossingDelay = scenario === "closure" ? 9 : scenario === "reopening" ? 4 : 0;
  const routes = useMemo(() => initialRoutes.map((route) => {
    const delay = route.id === "crossing" ? crossingDelay : 0;
    return { ...route, delay, total: route.base + delay, recommendation: route.name === data.bestRoute };
  }), [crossingDelay, data.bestRoute]);
  const recommendRoute = routes.find((route) => route.recommendation) ?? routes[0];

  function report(status: "closed" | "open") {
    if (status === "closed") {
      setClosedVotes((votes) => votes + 1);
      setToast("Your nearby confirmation was added. It will be weighted by your reliability score.");
    } else {
      setOpenVotes((votes) => votes + 1);
      setToast("Your reopening report was added. Conflicting reports are kept visible until resolved.");
    }
  }

  function chooseScenario(next: Scenario) {
    setScenario(next);
    setToast(`${scenarioCopy[next].liveLabel}. The route recommendation was recalculated.`);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RailCross home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Rail<span>Cross</span></span></a>
        <div className="searchbar" aria-label="Route search"><span className="search-dot origin-dot" aria-hidden="true" /><input aria-label="Origin" defaultValue="NIT Jamshedpur" /><span className="search-line" aria-hidden="true" /><span className="search-dot destination-dot" aria-hidden="true" /><input aria-label="Destination" defaultValue="Tata Main Hospital" /><button className="search-button" aria-label="Find routes">⌕</button></div>
        <div className="topbar-actions"><span className="demo-chip"><span /> Demo signals</span><button className="avatar" aria-label="User profile">AS</button></div>
      </header>

      <section className="map-workspace" id="top">
        <div className={`map-canvas scenario-${scenario}`} aria-label="RailCross route map of Jamshedpur">
          <div className="map-grid" /><div className="neighborhood neighborhood-top">Kadma</div><div className="neighborhood neighborhood-right">Bistupur</div><div className="neighborhood neighborhood-bottom">Adityapur</div><div className="waterway">Kharkai river</div><span className="road road-one" /><span className="road road-two" /><span className="road road-three" />
          <span className="rail-line"><b>Rail corridor</b></span><span className="route route-primary" /><span className="route route-alternate" /><span className="start-pin" title="NIT Jamshedpur">A</span><span className="destination-pin" title="Tata Main Hospital">B</span>
          <button className="crossing-marker" aria-label="View Adityapur railway crossing"><span className={`marker-pulse ${data.statusTone}`} /><span className={`marker-core ${data.statusTone}`}>⌁</span><span className="marker-label">Adityapur crossing</span></button><div className="traffic-wave wave-one" /><div className="traffic-wave wave-two" /><div className="traffic-wave wave-three" />
          <div className="map-controls" aria-label="Map controls"><button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button></div><div className="map-legend"><span><i className="legend-route" /> Recommended route</span><span><i className="legend-crossing" /> Railway crossing</span></div><div className="map-disclaimer">Concept demo · status is simulated until live sources are connected</div>
        </div>

        <aside className="route-panel" aria-label="Route options">
          <div className="panel-kicker">Trip analysis</div><h1>A route that understands the crossing.</h1><p className="panel-subtitle">We compare travel time, predicted queue clearance, community reports and your arrival risk.</p>
          <div className="arrival-card"><span className="arrival-label">Arrival-risk forecast</span><strong>{data.arrivalRisk}%</strong><p>chance the crossing will delay you when you arrive in about 15 minutes.</p><div className="risk-bar"><span style={{ width: `${data.arrivalRisk}%` }} /></div></div>
          <div className="route-list">{routes.map((route) => <button key={route.id} className={`route-card ${selectedRoute === route.id ? "selected" : ""} ${route.recommendation ? "recommended" : ""}`} onClick={() => setSelectedRoute(route.id)}><span className={`route-swatch ${route.className}`} /><span className="route-content"><strong>{route.name}</strong><small>{route.distance} · {route.delay ? `+${route.delay} min crossing delay` : "no crossing delay"}</small></span><span className="route-time">{route.total}<small>min</small></span>{route.recommendation && <span className="recommend-badge">Best now</span>}</button>)}</div>
          <button className="start-route" onClick={() => { setRouteStarted(true); setToast(`Navigation preview started via ${recommendRoute.name}.`); }}>{routeStarted ? "Navigation preview active" : `Start via ${recommendRoute.name}`} <span>→</span></button><p className="route-footnote">Recommendation updates when live evidence changes.</p>
        </aside>

        <aside className="crossing-panel" aria-label="Adityapur railway crossing details">
          <div className="panel-heading"><div><span className="eyebrow">Live crossing signal</span><h2>Adityapur Railway Crossing</h2></div><button className="more-button" aria-label="More crossing options">•••</button></div><div className="status-row"><span className={`status-pill ${data.statusTone}`}><i /> {data.status}</span><span className="freshness">updated 42 sec ago</span></div>
          <div className="wait-grid"><div><span>Predicted wait</span><strong>{data.wait}</strong></div><div><span>Signal confidence</span><strong>{data.confidence}%</strong></div></div><div className="evidence-card"><div className="evidence-icon">✦</div><div><strong>Why we think this</strong><p>{data.reason}</p></div></div>
          <div className="signal-list"><div><span className="signal-bullet traffic" /><p><strong>Traffic pattern</strong><small>{data.traffic}</small></p><b>78%</b></div><div><span className="signal-bullet community" /><p><strong>Community reports</strong><small>{reports} nearby reports · {communityConfidence}% agree</small></p><b>{communityConfidence}%</b></div><div><span className="signal-bullet history" /><p><strong>Historical pattern</strong><small>Similar closures tend to clear in 9 min</small></p><b>66%</b></div></div>
          <div className="report-box"><div><strong>Are you near the crossing?</strong><span>Your report helps verify the live signal.</span></div><div className="report-actions"><button onClick={() => report("closed")}>Still closed</button><button onClick={() => report("open")}>Now open</button></div></div><div className="trust-note"><span className="trust-icon">◒</span><p><strong>Your report reliability: 82%</strong><small>Confirmed reports gain influence. Unresolved events do not change your score.</small></p></div>
        </aside>
      </section>

      <section className="bottom-dock" aria-label="Demo controls and status"><div className="toast"><span className="toast-icon">✦</span>{toast}</div><div className="scenario-switcher" role="group" aria-label="Demo scenario controls"><span>Test the decision engine</span><button className={scenario === "closure" ? "active" : ""} onClick={() => chooseScenario("closure")}>Gate closed</button><button className={scenario === "reopening" ? "active" : ""} onClick={() => chooseScenario("reopening")}>Reopening</button><button className={scenario === "clear" ? "active" : ""} onClick={() => chooseScenario("clear")}>Clear flow</button></div></section>
    </main>
  );
}
