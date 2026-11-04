/* Service worker: web push for the member portal. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Notification', {
    body: data.body || '', data: { url: data.url || '/member/notifications' }, tag: data.tag || undefined,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || '/member/notifications', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url.href); return c.focus(); }
    return clients.openWindow(url.href);
  }));
});
