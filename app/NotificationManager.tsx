"use client";

import { useState } from "react";

type NotificationManagerProps = {
  crossings: Array<{ id: string; district: string; osm_node_id: number }>;
};

export default function NotificationManager({ crossings }: NotificationManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEnabled, setIsEnabled] = useState(
    () => typeof Notification !== "undefined" && Notification.permission === "granted"
  );
  const [commuteTime, setCommuteTime] = useState("");
  const [selectedCrossings, setSelectedCrossings] = useState<string[]>([]);
  const [alertOnClose, setAlertOnClose] = useState(true);
  const [alertOnOpen, setAlertOnOpen] = useState(false);

  const handleToggleAlerts = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("Push notifications are not supported by this browser.");
      return;
    }

    if (isEnabled) {
      // Unsubscribe logic
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
          await fetch("/api/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        }
        setIsEnabled(false);
      } catch (err) {
        console.error("Unsubscription failed:", err);
      }
    } else {
      // Request permission and subscribe
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          alert("Notification permission denied.");
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          // In production, we'd use a real public VAPID key
          // For the prototype we use a mock public key string
          const mockVapidKey = "BEl62vPPTsbES4FJK8k985m9MCxuTQH96m5mw9nQk6k=";
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: mockVapidKey,
          });
        }

        const encodeKey = (key: ArrayBuffer | null) => {
          if (!key) throw new Error("Push subscription did not provide an encryption key.");
          return btoa(String.fromCharCode(...new Uint8Array(key)));
        };
        const keys = {
          p256dh: encodeKey(subscription.getKey("p256dh")),
          auth: encodeKey(subscription.getKey("auth")),
        };

        await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            keys,
            crossingIds: selectedCrossings.length > 0 ? selectedCrossings : null,
            commuteTime: commuteTime || null,
            alertOnClose: alertOnClose ? 1 : 0,
            alertOnOpen: alertOnOpen ? 1 : 0,
          }),
        });

        setIsEnabled(true);
      } catch (err) {
        console.error("Subscription failed:", err);
      }
    }
  };

  const handleCrossingToggle = (id: string) => {
    setSelectedCrossings((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="notification-manager-wrapper">
      <button
        className={`notification-bell ${isEnabled ? "notification-bell-active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Manage alerts"
      >
        🔔
        {isEnabled && <span className="notification-badge" />}
      </button>

      {isOpen && (
        <aside className="notification-dropdown">
          <header className="notification-header">
            <h4>Railway Alert Settings</h4>
            <button className="notification-close-btn" onClick={() => setIsOpen(false)}>×</button>
          </header>

          <div className="notification-body">
            <label className="notification-toggle-label">
              <span>Enable Push Alerts</span>
              <input
                type="checkbox"
                className="notification-toggle"
                checked={isEnabled}
                onChange={handleToggleAlerts}
              />
            </label>

            {isEnabled && (
              <div className="notification-settings-expanded">
                <fieldset className="notification-fieldset">
                  <legend>Trigger Alerts On:</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={alertOnClose}
                      onChange={(e) => setAlertOnClose(e.target.checked)}
                    />
                    Gate Closure (Model prediction CLOSED)
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={alertOnOpen}
                      onChange={(e) => setAlertOnOpen(e.target.checked)}
                    />
                    Gate Reopening
                  </label>
                </fieldset>

                <fieldset className="notification-fieldset">
                  <legend>Commute Schedule Alert:</legend>
                  <label className="commute-time-row">
                    <span>Alert daily at:</span>
                    <input
                      type="time"
                      value={commuteTime}
                      onChange={(e) => setCommuteTime(e.target.value)}
                    />
                  </label>
                </fieldset>

                <div className="crossing-selector-section">
                  <h5>Monitored Crossings ({selectedCrossings.length || "All"})</h5>
                  <div className="crossing-checkbox-list">
                    {crossings.map((c) => (
                      <label key={c.id} className="crossing-checkbox-row">
                        <input
                          type="checkbox"
                          checked={selectedCrossings.includes(c.id)}
                          onChange={() => handleCrossingToggle(c.id)}
                        />
                        <span>Node {c.osm_node_id} ({c.district})</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
