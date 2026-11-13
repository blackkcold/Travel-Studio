# Run and maintain Travel Studio

## Local installation

Use Node.js **22.12 or newer** with npm on macOS, Windows or Linux. From a checkout or source release:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4173`. Keep this origin stable so the browser uses the same local project database. `PORT=...` can select another port through the environment or `.env`, but that creates a different browser storage origin. The production server binds only to loopback. It serves only the `dist` directory; it does not expose the source tree, `.env` or arbitrary local paths.

The default map, terrain and explicit address search require network access and their external providers. Photos, edits and project storage remain local. API keys are not needed for the basic workflow. Download `.travelstudio` project backups before clearing browser data or changing machines.

## Static deployments and phones

The `dist/` directory is a static application and can be served on an HTTPS origin. A static-only deployment has no secret-bearing AI gateway; use local image processing or provide a separately secured same-origin gateway. Do not place private keys in `VITE_` variables, source files or project packages. Use HTTPS for mobile access; import/export behavior still depends on the target browser and must be checked on the actual device.

This release does not install a service worker/PWA or bundle offline map tiles. Keeping a saved map image is different from having complete offline map editing.

## Optional AI gateway

Copy `.env.example` to `.env` and set only the services you want to enable. Node loads `.env` at startup; credentials stay in the loopback process.

| Variable | Meaning |
| --- | --- |
| `AI_KEY` | Secret server-side credential; absent means AI is disabled |
| `AI_BASE_URL` | Public HTTPS OpenAI-compatible base endpoint; default `https://api.openai.com/v1` |
| `AI_PROVIDER_ID` | Consent identity; default `configured-ai` |
| `AI_MODEL` | Configured image-edit model; default `gpt-image-1` |
| `AI_VISION_MODEL` | Optional chat/vision model for unconfirmed landmark suggestions |
| `PORT` | Local HTTP port, default 4173 |

Image stylization calls `/images/edits` with multipart image/prompt/model and requires an inline `b64_json` result. It does not fetch arbitrary returned image URLs. Provider endpoint/model compatibility must be checked with that service; a configured key does not imply every OpenAI-compatible endpoint implements image edits.

The browser must explicitly authorize the selected photo and purpose. `/api/ai/status` exposes availability/model/provider identity without credentials. POST requests require matching loopback Host/Origin and `X-Travel-Studio-Request: 1`; cross-site requests, redirects, client-selected endpoints, unsupported fields and images above the request budget are rejected. AI concurrency is one, request budget 20 MB, timeout 120 seconds. Landmarks returned by `/api/ai/locate` are candidates requiring user confirmation, never authoritative GPS or calibrated probabilities.

Do not expose this loopback gateway directly to the public internet or LAN. A shared deployment needs its own authentication, authorization, Origin/Host policy and rate limits. Without an AI key, original-photo composition, local recipes, maps and file export still work.

## Development and validation

```sh
npm run dev
npm run check
npm test
npm run test:e2e
```

`npm run test:providers` checks external services under their policies. Do not repeatedly run provider smoke tests as a load test. Browser test artifacts record actual results; synthetic fixtures establish image and metadata contracts, not real-photograph aesthetic or device-performance claims.

To reproduce the small local photo fixtures, use Pillow and `python scripts/generate-fixtures.py`. Add `--stress` to write a synthetic 48 MP JPEG under ignored `test-results/fixtures/`; it is deliberately excluded from the release source payload. See `docs/ACCEPTANCE.md` for exactly which gates and devices were exercised.

## Maintenance

Commit dependency changes with `package-lock.json`. After MapLibre, Konva, browser, schema or font upgrades, recheck fixed-camera export, actual backing pixels, CJK line breaks, project restoration and source attribution. Keep the last working project format fixture. Review provider policy URLs before releases, disable automatic traffic after limits/outages, and retain explicit manual-coordinate and saved-frame recovery paths.

On storage failure, keep the current tab open and download a project; do not clear original photos to free space before a backup. On map/terrain failure, preserve the last valid snapshot or explicitly choose a documented fallback. A network failure must not be reported as a successful map render. Diagnostics exclude photo bytes, full queries, precise coordinates and secrets.
