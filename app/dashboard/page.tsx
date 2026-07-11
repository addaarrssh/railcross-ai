"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DemoCrossingStat = {
  crossingId: string;
  district: string;
  osmNodeId: number;
  avgClosuresPerDay: number;
  avgDurationMinutes: number;
  status: "OPEN" | "CLOSED";
  peakHour: number;
};

export default function HistoricalDashboard() {
  const [stats, setStats] = useState<DemoCrossingStat[]>([]);
  const [heatmapData, setHeatmapData] = useState<number[][]>([]); // 7 rows (days) x 24 cols (hours)
  const [loading, setLoading] = useState(true);

  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch("/jharkhand_crossing_predictions.json");
        if (!res.ok) throw new Error("Failed to load predictions");
        const data = await res.json();
        const crossings = data.crossings || [];

        // Build stats
        const compiledStats: DemoCrossingStat[] = crossings.map((c: { id: string; district: string; osm_node_id: number; prediction: { predicted_status: "OPEN" | "CLOSED" } }) => {
          const hash = c.id.split("").reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
          const avgClosures = (hash % 4) + 2;
          const avgDuration = (hash % 8) + 6;
          
          return {
            crossingId: c.id,
            district: c.district,
            osmNodeId: c.osm_node_id,
            avgClosuresPerDay: avgClosures,
            avgDurationMinutes: avgDuration,
            status: c.prediction.predicted_status,
            peakHour: 8 + (hash % 12),
          };
        });

        // Sort by busiest (most closures)
        compiledStats.sort((a, b) => b.avgClosuresPerDay - a.avgClosuresPerDay);
        setStats(compiledStats);

        // Generate heatmap data (simulating average closure probability for 7 days x 24 hours)
        const grid = Array.from({ length: 7 }).map((_, dIndex) => {
          return Array.from({ length: 24 }).map((_, hIndex) => {
            // High probabilities during rush hours (8-10 AM, 5-7 PM)
            const isMorningRush = hIndex >= 8 && hIndex <= 10;
            const isEveningRush = hIndex >= 17 && hIndex <= 19;
            const baseProb = isMorningRush || isEveningRush ? 0.65 : 0.15;
            
            // Weekend has slightly different pattern
            const weekendFactor = dIndex >= 5 ? -0.15 : 0.05;
            
            // Add some noise
            const noise = (Math.sin(hIndex * 0.5) + Math.cos(dIndex * 0.8)) * 0.08;
            return Math.max(0.02, Math.min(0.98, baseProb + weekendFactor + noise));
          });
        });
        setHeatmapData(grid);
      } catch (err) {
        console.error("Dashboard data load error:", err);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  if (loading) {
    return <main className="dashboard-page-loading">Generating historical analytics...</main>;
  }

  // Aggregate stats
  const totalCrossings = stats.length;
  const avgClosures = stats.reduce((acc, s) => acc + s.avgClosuresPerDay, 0) / (totalCrossings || 1);
  const avgDuration = stats.reduce((acc, s) => acc + s.avgDurationMinutes, 0) / (totalCrossings || 1);
  const totalClosed = stats.filter((s) => s.status === "CLOSED").length;

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <Link href="/" className="dashboard-back-link">
          ← Back to Map View
        </Link>
        <h1>RailCross Traffic & Closure Analytics</h1>
        <p className="dashboard-subtitle">Synthetic demonstration analytics — not measured operational history</p>
      </header>

      {/* Stats Cards Grid */}
      <section className="stats-grid" aria-label="Key Performance Indicators">
        <article className="stat-card">
          <h3>Total Monitored Gates</h3>
          <p className="stat-number">{totalCrossings}</p>
          <span className="stat-trend">Coverage across 3 districts</span>
        </article>
        <article className="stat-card">
          <h3>Avg. Daily Closures</h3>
          <p className="stat-number">{avgClosures.toFixed(1)}</p>
          <span className="stat-trend">Per crossing gate</span>
        </article>
        <article className="stat-card">
          <h3>Avg. Closure Duration</h3>
          <p className="stat-number">{avgDuration.toFixed(1)} min</p>
          <span className="stat-trend">Draining time included</span>
        </article>
        <article className="stat-card">
          <h3>Currently Closed Gates</h3>
          <p className="stat-number stat-danger">{totalClosed}</p>
          <span className="stat-trend">Active traffic bottlenecks</span>
        </article>
      </section>

      {/* Heatmap Section */}
      <section className="heatmap-container" aria-label="Closure Heatmap">
        <h2>Weekly Closure Probability Heatmap</h2>
        <p className="section-desc">Intensity indicates P(Gate Closed) by day of week and hour of day</p>
        <div className="heatmap-grid-scroll">
          <div className="heatmap-grid-wrapper">
            {/* Hour headers */}
            <div className="heatmap-hour-headers">
              <div className="heatmap-label-spacer" />
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="heatmap-hour-label">
                  {h.toString().padStart(2, "0")}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            {heatmapData.map((row, dIdx) => (
              <div key={dIdx} className="heatmap-row">
                <div className="heatmap-day-label">{daysOfWeek[dIdx].substring(0, 3)}</div>
                {row.map((val, hIdx) => {
                  // Determine background color opacity based on value
                  let bg = "#188038"; // Green
                  let opacity = 0.15;
                  if (val > 0.6) {
                    bg = "#d93025"; // Red
                    opacity = val;
                  } else if (val > 0.3) {
                    bg = "#f9ab00"; // Yellow
                    opacity = val;
                  } else {
                    opacity = val * 0.7 + 0.1;
                  }

                  return (
                    <div
                      key={hIdx}
                      className="heatmap-cell"
                      style={{ backgroundColor: bg, opacity }}
                      title={`${daysOfWeek[dIdx]} ${hIdx}:00 - Probability: ${Math.round(val * 100)}%`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <footer className="heatmap-legend">
          <span>Low Risk (&lt;30%) <i className="legend-box green" /></span>
          <span>Medium Risk (30-60%) <i className="legend-box yellow" /></span>
          <span>High Risk (&gt;60%) <i className="legend-box red" /></span>
        </footer>
      </section>

      {/* Leaderboard & Recommendation Grid */}
      <div className="dashboard-split-grid">
        <section className="leaderboard-section" aria-label="Busiest crossings">
          <h2>Top Busiest Crossings</h2>
          <div className="table-responsive">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>OSM Node ID</th>
                  <th>District</th>
                  <th>Daily Closures</th>
                  <th>Avg Duration</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {stats.slice(0, 5).map((s, idx) => (
                  <tr key={idx}>
                    <td><strong>{s.osmNodeId}</strong></td>
                    <td>{s.district}</td>
                    <td>{s.avgClosuresPerDay} closures</td>
                    <td>{s.avgDurationMinutes} mins</td>
                    <td>
                      <span className={`status-dot ${s.status === "CLOSED" ? "dot-closed" : "dot-open"}`} />
                      {s.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="recommendation-section" aria-label="Recommendations">
          <h2>Safest Commute Windows</h2>
          <div className="recommendations-container">
            {stats.slice(0, 3).map((s, idx) => {
              const safeMorning = `${(s.peakHour - 3 + 24) % 24}:00 - ${(s.peakHour - 1 + 24) % 24}:00`;
              const safeAfternoon = `${(s.peakHour + 2) % 24}:00 - ${(s.peakHour + 5) % 24}:00`;
              return (
                <article key={idx} className="safe-time-card">
                  <h4>Crossing Node {s.osmNodeId}</h4>
                  <p>Avoid rush hours at <strong>{s.peakHour}:00</strong>. Best travel windows:</p>
                  <ul>
                    <li>🌅 Morning: <strong>{safeMorning}</strong></li>
                    <li>🌆 Afternoon: <strong>{safeAfternoon}</strong></li>
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
