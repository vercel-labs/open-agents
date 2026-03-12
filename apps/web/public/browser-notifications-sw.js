self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url;
  if (!targetUrl) {
    return;
  }

  event.waitUntil(
    (async () => {
      const absoluteUrl = new URL(targetUrl, self.location.origin).toString();
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(absoluteUrl);
        }
        return;
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(absoluteUrl);
      }
    })(),
  );
});
