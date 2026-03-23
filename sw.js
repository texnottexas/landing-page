'use strict';

// Service worker for 2864tw.com push notifications
// Minimal — no caching strategy (GitHub Pages CDN is fast enough)

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  var title  = data.title  || 'TW Server 2864';
  var options = {
    body:    data.body   || '',
    icon:    data.icon   || '/icons/icon-192.png',
    badge:   data.badge  || '/icons/icon-192.png',
    tag:     data.tag    || 'tw2864-push',
    renotify: true,
    data:    { url: data.url || 'https://2864tw.com' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://2864tw.com';
  // Allow external URLs (Discord, etc.) — open in new window
  var isExternal = targetUrl.indexOf('https://2864tw.com') !== 0;

  event.waitUntil(
    isExternal
      ? self.clients.openWindow(targetUrl)
      : self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
          for (var i = 0; i < clients.length; i++) {
            if (clients[i].url.startsWith('https://2864tw.com') && 'focus' in clients[i]) {
              if (clients[i].url !== targetUrl && 'navigate' in clients[i]) {
                return clients[i].navigate(targetUrl).then(function(c) { return c.focus(); });
              }
              return clients[i].focus();
            }
          }
          return self.clients.openWindow(targetUrl);
        })
  );
});
