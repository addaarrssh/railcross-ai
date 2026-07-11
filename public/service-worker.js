const CACHE_NAME = "railcross-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/favicon.svg",
];

// Install Event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate Event
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// Fetch Event
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Predictions or API data - Network First
  if (url.pathname.includes("/jharkhand_crossing_predictions.json") || url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clonedResponse);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // Static assets - Cache First
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
    );
  }
});

// Push Notification Event
self.addEventListener("push", (event) => {
  let data = { title: "RailCross Alert", body: "Railway gate closure detected nearby." };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "RailCross Alert", body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: data.crossingId ? { crossingId: data.crossingId } : null,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification Click Event
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const crossingId = event.notification.data ? event.notification.data.crossingId : null;
  
  let targetUrl = "/";
  if (crossingId) {
    targetUrl = `/?crossingId=${crossingId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.navigate(targetUrl).then((c) => c.focus());
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
