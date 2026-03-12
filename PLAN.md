Summary: Investigate adding browser notifications alongside the web app’s existing notification UI.

Context:
- The only user-facing toast-style notification flow currently in the web app is the background session completion hook in `apps/web/hooks/use-background-chat-notifications.tsx`, which shows a Sonner toast and plays a sound when a non-active session finishes streaming.
- That hook is wired from `apps/web/app/sessions/sessions-route-shell.tsx`, so background chat completion is the current place where “web app notifications” are emitted automatically.
- Global app-level client state lives in `apps/web/app/providers.tsx`; it already manages one browser-local preference (theme) with `localStorage`, which is a good fit for notification settings that are browser/device specific.
- The settings UI lives in `apps/web/app/settings/preferences-section.tsx` and already contains browser-specific preferences plus per-user backend-backed preferences.
- There is no existing `Notification` API usage, service worker, web app manifest, or push subscription plumbing in `apps/web`, so true push notifications while the app/browser is closed would be a substantially larger feature.

Open questions:
- Should browser notifications mirror only the existing background chat completion notifications, or every toast/notification in the app?
- Is page-open desktop notification support enough (using the browser `Notification` API), or do you want full web push support that can notify even when the app/browser is closed?
