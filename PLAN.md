Summary: Add browser Notification API support for the existing background chat completion flow so users get a desktop/browser notification when a non-active session finishes, while keeping the current in-app toast and sound behavior.

Context:
- `apps/web/hooks/use-background-chat-notifications.tsx` is the current automatic notification path in the web app. It detects background sessions that finished streaming, shows a Sonner toast, and plays `Submarine.wav`.
- `apps/web/app/sessions/sessions-route-shell.tsx` mounts that hook for the sessions experience, so this is the right integration point for background chat completion notifications.
- `apps/web/app/providers.tsx` already owns browser-local UI state (theme via `localStorage`) and is a natural place to expose browser-notification capability/state to the rest of the app.
- `apps/web/app/settings/preferences-section.tsx` is where browser- and user-level preferences are configured today, so it should surface an enable/request-permission control for browser notifications.
- There is no existing service worker, manifest, or push subscription plumbing in `apps/web`, so the chosen approach is page-open desktop notifications only, not full push notifications.

Approach: Introduce a small browser-notification preference/context stored per browser, request notification permission from settings, and reuse the existing background chat completion hook to fire a browser notification alongside the current toast when permission is granted. Keep the implementation local to the existing background notification feature rather than introducing a broader app-wide notification abstraction.

Changes:
- `apps/web/app/providers.tsx` - add browser notification state/helpers (support detection, permission status, enabled flag, permission request, localStorage persistence) and expose them through a hook/context similar to theme.
- `apps/web/app/settings/preferences-section.tsx` - add a browser notification preference row that lets the user enable desktop notifications for background chat completions and request permission in the current browser.
- `apps/web/hooks/use-background-chat-notifications.tsx` - extend the existing completion flow to emit a browser notification when enabled/allowed, preserve the current Sonner toast + sound, and wire notification click behavior to focus/navigate into the finished chat.
- `apps/web/hooks/use-background-chat-notifications.test.ts` - add/adjust unit coverage for the notification decision logic extracted from the hook.

Verification:
- Run `bun run ci` from the repo root.
- Manually open the web app, enable browser notifications in Settings → Preferences, grant permission, start a background session, and confirm that when it finishes you get both the existing in-app toast and a browser notification.
- Click the browser notification and confirm it focuses/navigates to the finished session.
- Edge cases: permission denied, notifications disabled in settings, active session finishes (should still avoid background completion notifications), unsupported browser/API.
