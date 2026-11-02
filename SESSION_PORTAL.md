# Session connection portal

Release acceptance includes checking `PORTAL_ORIGIN`, HTTPS and proxy settings on your server before inviting real users.

The root URL now serves a Persian session connection flow. Administrative API endpoints and the old dashboard remain separate. No session can be created through the portal until the operator manually approves the applicant and issues a phone-bound invitation.

## Operator setup

1. Set a strong, unique `API_KEY` (administrator credential).
2. Set `PORTAL_ORIGIN` to the exact public HTTPS origin, e.g. `https://wa.example.com`. It must have no path. When using `BASE_PATH=/whatsapp`, the origin is still `https://wa.example.com`.
3. Put the localhost-bound container behind a trusted HTTPS reverse proxy. Set `TRUST_PROXY=TRUE` only when the port cannot be accessed except through that proxy, and make the proxy replace client-supplied forwarded headers. HTTPS is mandatory for production cookies; avoid HTTP access to the production portal.
4. Set `PORTAL_MAX_SESSIONS` for the server's memory budget (default 10, maximum 100). Each active WhatsApp account uses a Chromium process. Portal sessions recover on service restart; after an unexpected browser disconnect, the user can retry explicitly from the portal (the legacy automatic browser recovery hook is disabled for portal accounts). Only two portal initializations may run concurrently. Use one application instance with its persistent sessions volume; the file store and in-memory admission counters do not support multi-replica deployments.
5. Open `/portal-admin/` (under `BASE_PATH` if configured). Verify the person's identity and phone ownership through your trusted manual process before issuing a code. The portal does not send SMS or independently verify the applicant's real-world identity.
6. Enter the administrator key and approved international phone number. Give the generated invitation to that person through a trusted channel. It expires after 24 hours, is bound to that number, and can be redeemed once. Issuing another invitation for the same number revokes the earlier one. The administrator key is never stored by the new admin page.

For scripted administration, POST JSON `{ "phone": "989123456789" }` to `/portal-admin/invitations` with the administrator `x-api-key`, `Content-Type: application/json`, and `Origin` equal to `PORTAL_ORIGIN`. DELETE with the same headers/body revokes outstanding invitations for that number. No notification is sent automatically.

## User flow

- Enter the approved number and invitation on the root page. No Chromium instance is allocated before invitation validation.
- Save the session key displayed once. The browser receives an HttpOnly, SameSite=Strict cookie; no session key is stored in localStorage. The key is required for API calls and recovery from a different browser.
- Scan the QR in WhatsApp Linked Devices. A QR is a bearer credential: never share or screenshot a live one. After the ready event, the actual WhatsApp account number must match the approved number. A mismatch is logged out and never receives API access.
- The page confirms API readiness only after this check. Returning in the same browser restores the session view. A different browser needs the number plus the saved session key; knowing a number alone grants no access.
- “Close WhatsApp session” requires authentication, same-origin JSON and a CSRF token. It immediately revokes local access (persisted before network calls), attempts WhatsApp logout with a bounded timeout, and removes the local session and credentials. If remote logout cannot be confirmed, the page asks the user to unlink the device on their phone. A new connection then needs a fresh invitation. Closing does not erase WhatsApp messages on the phone.

Pending, never-verified accounts expire after ten minutes. Their access keys and browser profiles are cleaned up. Connected account credentials persist with the session volume. Existing sessions created through the legacy administrator API are not automatically claimed by number.

## Scoped API

Use the generated session ID and the user's key as `x-api-key`. The root page shows a curl example. Current allowed endpoints:

- GET `/client/getState/:sessionId`
- GET `/client/getClassInfo/:sessionId`
- GET `/client/getChats/:sessionId`
- GET `/client/getContacts/:sessionId`
- POST `/client/sendMessage/:sessionId` with `{ "chatId": "989123456789@c.us", "contentType": "string", "content": "Hello" }`.

User keys cannot enumerate or administer sessions, access other accounts, change webhook URLs, open the administrator WebSocket, fetch remote media URLs, or execute arbitrary client methods. Text messages are limited to 10,000 characters; caller-supplied message options are ignored. Portal accounts do not forward their data to the global webhook. The administrator API retains its existing full capabilities; keep its key on trusted systems.

## Controls and limits

- 256-bit random invitation/session secrets; only hashes on disk. Credential files are private and atomically replaced.
- Restrictive CSP, frame protection, no third-party scripts, no-store responses, no raw HTML insertion, no secrets in URLs, and secure production cookies.
- Exact-origin checks and JSON-only mutations; session mutations additionally require a session-bound CSRF header.
- IP limits: 120 portal requests/minute, 5 connect/recovery attempts/hour, 10 administrator invitation operations/minute. User API calls: 60/minute per key. Limit state is local to one process and resets on restart.
- Portal request bodies: 4 KiB. User API bodies: 16 KiB. Invalid API credentials are rejected before request-body buffering. Server request/header timeouts are bounded.
- Global limits bound account count and simultaneous startup. They reduce abuse but do not guarantee availability against distributed attacks. Put additional connection/request limits at the reverse proxy or hosting edge for an Internet-facing service.

Automated tests cover admission, secret storage, invitation expiry/replay/binding, CSRF, ownership mismatch, credential restoration, API isolation and media URL rejection. A real account scan, messaging and WhatsApp reconnect/persistence remain deployment acceptance tests. HTTPS/proxy behavior must also be validated on the actual server.
