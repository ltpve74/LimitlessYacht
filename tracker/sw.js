/* Limitless Tracker service worker — push notifications for the installed PWA */
/* v7: expense deletes tombstone + deletedIds (no duplicate resurrect) */
self.addEventListener("install", function (e) {
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(self.clients.claim());
});

function isTrackerClient(c) {
  return !!(c && c.url && c.url.indexOf("/tracker") !== -1);
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
  var silent = !!data.silent;
  var msg = {
    type: "tracker-data-changed",
    reason: silent ? "push-sync" : "push",
    title: data.title || "",
    body: data.body || "",
    tag: data.tag || "tracker",
    silent: silent,
  };
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      var trackerOpen = list.some(isTrackerClient);
      list.forEach(function (c) {
        try {
          if (c && c.postMessage) c.postMessage(msg);
        } catch (e) {}
      });
      /*
       * Silent sync (cash-in / expenses): refresh open tabs quietly.
       * Only show a system banner when nothing is open (keeps push healthy +
       * avoids spam while phone and desktop are both in use).
       */
      if (silent && trackerOpen) return;
      return self.registration.showNotification(data.title || "Limitless Tracker", {
        body: data.body || "",
        icon: "/tracker/icons/icon-192.png",
        badge: "/tracker/icons/icon-192.png",
        tag: data.tag || (silent ? "tracker-sync" : "tracker"),
        renotify: !silent,
        silent: silent,
        data: { url: data.url || "/tracker/" },
      });
    })
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
