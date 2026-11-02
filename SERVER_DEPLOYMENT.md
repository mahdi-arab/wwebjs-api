# Docker releases and server deployment

Images: `ghcr.io/mahdi-arab/wwebjs-api`. Supports Linux amd64 and arm64.

## Build and release

Pull requests and manual workflow runs build and check the image without publishing. The workflow checks offline tests, the production dependency audit, application authentication, and an actual Chromium launch/page evaluation inside Docker. It also builds both supported architectures. No WhatsApp account or QR is needed for these checks.

After merging a version into main, publish a stable version tag:

```sh
git switch main
git pull --ff-only origin main
git tag v1.0.0
git push origin v1.0.0
```

The `Docker build and release` workflow validates the tag format and confirms its commit belongs to main. After validation and image tests, it publishes version and `latest` tags to GHCR, with SBOM/provenance metadata, then creates a GitHub Release containing deployment files and the image digest. Later releases use a new version (e.g. v1.0.1); do not move published tags. Do not publish an older release after a newer one, since a release also updates `latest`.

Publishing uses the repository's automatic `GITHUB_TOKEN`, with package write permission; no Docker Hub subscription or separate registry secret is needed. If organization policy blocks package creation, enable the relevant GitHub Actions/package permissions. New GHCR packages may be private: either make this package public in GitHub package settings, or authenticate the server using a token with `read:packages` before pulling.

## Server setup

Install Docker Engine and the Compose plugin. Download `compose.server.yml` and `.env.example` from a completed GitHub Release into a dedicated directory (or use this repository's main branch).

```sh
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

Edit `.env`: set `API_KEY` to the generated key, `ENABLE_WEBHOOK=FALSE` unless you have a receiver, and `ENABLE_WEB_UI=TRUE` if you want the dashboard. For webhooks, configure your own URL and separate `WEBHOOK_API_KEY`. Leave `CHROME_BIN` out of `.env` or set it to `/usr/bin/chromium` (do not copy a macOS path or an empty override into the container). Set `SESSIONS_PATH=/usr/src/app/sessions` so the named volume holds authentication data.

For private GHCR packages, log in once using a read-only package token through stdin:

```sh
read -r -s GHCR_TOKEN
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u mahdi-arab --password-stdin
unset GHCR_TOKEN
```

Choose a version whose release workflow has completed (v1.0.0 below is an example, not a claim that it already exists). Add `IMAGE_TAG=v1.0.0` to `.env`, then:

```sh
docker compose -f compose.server.yml pull
docker compose -f compose.server.yml up -d
docker compose -f compose.server.yml ps
docker compose -f compose.server.yml logs --tail=100 api
```

The port binds to localhost. Put an HTTPS reverse proxy in front, or use an SSH tunnel to access `http://localhost:3000/dashboard/`. Enter the API key, create a session and scan its QR in WhatsApp Linked Devices. Account authentication, messaging, reconnect and restart persistence must still be tested with your account. Network access to WhatsApp Web is required.

The healthcheck probes `/ping` with the configured port and base path. Healthy means the API is available, not that a WhatsApp account is connected.

## Upgrade and rollback

Change `IMAGE_TAG` in `.env` to the desired release, run `pull` and `up -d` again. For rollback, use the previous tag. Keep `wwebjs_sessions` backed up and do not run `down -v`, which deletes sessions. For immutable deployments, replace the compose image value with the full digest reference shown in the release (`ghcr.io/mahdi-arab/wwebjs-api@sha256:...`).

The existing `docker-compose.yml` remains available for local source builds. `compose.server.yml` only pulls our published image; it never builds upstream code on your server.
