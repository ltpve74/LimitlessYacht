/* Limitless Tracker service worker — push notifications for the installed PWA */
/* v2: on push / notification click, tell open tracker windows to soft-refresh data */
self.addEventListener("install", function (e) {
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(self.clients.claim());
});

function notifyOpenClients(payload) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then(function (list) {
      list.forEach(function (c) {
        try {
          if (c && c.postMessage) c.postMessage(payload || { type: "tracker-data-changed" });
        } catch (e) {}
      });
    });
}

self.addEventListener("push", function (event) {
  var data = { title: "Limitless Tracker", body: "Something changed", url: "/tracker/" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (err) {
    try {
      data.body = event.data ? event.data.text() : data.body;
    } catch (e2) {}
  }
  var msg = {
    type: "tracker-data-changed",
    reason: "push",
    title: data.title || "",
    body: data.body || "",
    tag: data.tag || "tracker",
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Limitless Tracker", {
        body: data.body || "",
        icon: "/tracker/icons/icon-192.png",
        badge: "/tracker/icons/icon-192.png",
        tag: data.tag || "tracker",
        renotify: true,
        data: { url: data.url || "/tracker/" },
      }),
      /* Open app instances refresh immediately — not only after notification click */
      notifyOpenClients(msg),
    ])
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/tracker/";
  var msg = { type: "tracker-data-changed", reason: "notification-click" };
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf("/tracker") !== -1) {
          try {
            if (c.postMessage) c.postMessage(msg);
          } catch (e) {}
          if ("focus" in c) return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
