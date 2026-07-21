/* Limitless Tracker service worker — push notifications for the installed PWA */
self.addEventListener("install", function (e) {
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = { title: "Limitless Tracker", body: "Something changed", url: "/tracker/" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (err) {
    try {
      data.body = event.data ? event.data.text() : data.body;
    } catch (e2) {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Limitless Tracker", {
      body: data.body || "",
      icon: "/tracker/icons/icon-192.png",
      badge: "/tracker/icons/icon-192.png",
      tag: data.tag || "tracker",
      renotify: true,
      data: { url: data.url || "/tracker/" },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/tracker/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf("/tracker") !== -1 && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
