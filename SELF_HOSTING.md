# Self-hosted fork

Based on upstream commit 163e313a9352479862b632d8609a8fb6817fbb65.
MIT license and original copyright notices are retained. This fork has no premium tier or license server.

## Security changes

- WebSocket upgrade requires the inbound `x-api-key` header and fails closed without a configured key. Browser clients must use an authenticated reverse proxy; secrets in URLs are not supported.
- Outbound webhooks use only `WEBHOOK_API_KEY`, never the inbound `API_KEY`. Configure the webhook receiver to accept the separate credential. Webhook requests time out after 10 seconds.
- Scarf installation analytics are disabled in package configuration; lifecycle scripts are disabled in `.npmrc` and Docker installs. Browser installation must be managed explicitly.
- Startup rejects missing or example API keys. Full configuration is no longer logged. Webhook payloads and Axios request credentials are redacted from structured error logs.
- Direct dependency versions and the lockfile are pinned. Docker builds from our source and only exposes its port on localhost. Automatic upstream edge builds and upstream Docker publishing workflows were removed.
- The stale WhatsApp Web version override is removed from the example environment.

## Run locally

1. `npm ci --ignore-scripts`
2. Copy `.env.example` to `.env` and generate a unique `API_KEY` (for example with `openssl rand -hex 32`).
3. Set `CHROME_BIN` to an existing Chrome/Chromium executable. On macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
4. Set `ENABLE_WEBHOOK=FALSE` if no webhook is needed. Otherwise set your own `BASE_WEBHOOK_URL` and a separate `WEBHOOK_API_KEY`.
5. Enable `ENABLE_WEB_UI=TRUE` if desired; then `npm start` and open `/dashboard/`. Enter the inbound API key there. The dashboard stores it in browser localStorage: use a trusted browser profile.

For Docker, use `docker compose up --build -d`. This builds our source rather than pulling the upstream latest image. Keep the API behind localhost or a restricted HTTPS reverse proxy; this is a single shared administrator credential, not tenant isolation.

## Validation and remaining blockers

- `npm run test:offline`: 8 tests passed, including unauthorized WebSocket rejection, authorized event delivery, separate webhook credentials, and dashboard behavior.
- Four selected upstream API health/authentication/callback tests passed.
- `npm audit --omit=dev`: 26 affected package entries reduced to 17 (0 critical, 11 high, 6 moderate). See `security/npm-audit-production.json`. This count includes transitive/optional packages and propagated findings, not 17 independently exploitable issues. Remaining advisories in browser/archive dependency chains need compatibility work; do not bypass them with untested major overrides or downgrade WhatsApp Web.js solely because npm suggests it.
- A real isolated Chrome session successfully reached WhatsApp Web and emitted a QR after the VPN was enabled. The earlier attempt without VPN failed with `net::ERR_CONNECTION_CLOSED`. The test intentionally destroyed its temporary browser/session immediately after QR emission (a resulting TargetCloseError is teardown noise). Authentication, message delivery, reconnect, and session persistence still require scanning a live QR and remain unverified.
- Docker daemon is unavailable on the current machine, so the image was not built here.

This is a review candidate, not a production-approved migration. Keep existing sessions untouched until the remaining security findings and real WhatsApp tests are resolved. There is no guarantee of account safety or continued compatibility with the unofficial WhatsApp Web interface.
