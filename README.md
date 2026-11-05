# og-snap

Shared Open Graph screenshot service for Cloudflare Workers. Intended origin:
**https://og.ohn.sh**. Owns its Browser Run and private R2 bindings; consumers own
their preview pages, selection rules, scheduling, pinning, and HTML cache invalidation.

## Setup

Requires Node 22.18+ and Bun. The pinned Cloudflare CLI/Vite integration is beta.

```sh
bun install
cp .dev.vars.example .dev.vars
bun run dev
bun run build
bun test
bun run test:browser
bun run test:worker
```

Edit `.dev.vars` with separate random tokens (for example, `openssl rand -hex 32`).
Install local Chromium with `bunx playwright install chromium` if needed. Local
HTTP/R2 tests use Miniflare; hosted Browser Run itself is verified after deployment.
The browser tests verify proportional fitting in local Chromium. The runtime test
overrides the compatibility date to 2026-10-19 for the pinned local workerd;
production uses 2026-11-05.

Review `consumers.json` before deploying: each consumer has exact HTTPS preview
origin/path pairs and permitted subresource origins. Query strings may vary.
Days' preview route still needs to be implemented by that application. Check the
media/font origins against each application's actual network requests.

Authenticate the `cf` CLI with your Cloudflare account and enable Browser Run.
The deployment configuration provisions the `og-snap` R2 binding. Keep the bucket
private: only the Worker exposes public images and manifests.

For initial deployment, create an ignored `secrets.json` containing:

```json
{ "CONSUMER_TOKENS": "{\"vod\":\"YOUR_RANDOM_VOD_TOKEN\",\"days\":\"YOUR_RANDOM_DAYS_TOKEN\"}" }
```

```sh
bun run build
bunx cf deploy --prebuilt --mode production --secrets-file secrets.json
```

`cloudflare.config.ts` configures the custom domain `og.ohn.sh`. Subsequent deploys
can use `bun run deploy`. Set `PUBLIC_ORIGIN` to the intended public origin if using
a different hostname. No deployment or consumer migration is performed by setup.

## Capture API

```sh
curl https://og.ohn.sh/v1/snapshots \
  -H 'X-OG-Consumer: vod' \
  -H "Authorization: Bearer $OG_SNAP_TOKEN" \
  -H 'Idempotency-Key: capture-20261105-quad-001' \
  -H 'Content-Type: application/json' \
  --data '{
    "key": "cameras/quad",
    "url": "https://vod.ohn.sh/social/preview?camera=quad&width=1600&height=900",
    "resolution": {"width":1200,"height":630},
    "readySelector": "#social-preview[data-preview-state=ready]",
    "errorSelector": "#social-preview[data-preview-state=error]",
    "selector": "#social-preview",
    "metadata": {"camera":"quad","pinned":true},
    "publication": {"mode":"create"}
  }'
```

VOD's existing preview page already fits its internal composition into 1200×630:
pass its composition dimensions in the URL and capture its 1200×630 element as above.
For a generic full-viewport page, `resolution` directly sets the composition viewport.

- Default viewport: 1200×865. Width: 320–3840; height: 180–2160; integers required.
- Output: JPEG, **1200×630**, proportional contain-fit, centered padding, no cropping.
- Optional `selector`: capture exactly one element, within the same dimension limits.
- Default `readySelector`: `[data-og-ready="true"]`. It must become visible only
  after imagery, fonts, and video frames are ready. Optional `errorSelector` fails early.
- Optional `background`: six-digit hex color, default `#202020`.
- Metadata is public opaque JSON: object root, max 16 KiB, max depth 16.
- Total request limit: 32 KiB. Keys use slash-separated letters, digits, `_`, `-`.
- Navigation redirects and frames are blocked. Resource requests require configured
  HTTPS origins. Service workers and WebSockets are blocked. API tokens are never
  forwarded to the browser. Preview routes must be accessible without those tokens.

### Publication and concurrency

```ts
{ mode: 'create' }                               // default; key must not exist
{ mode: 'replace', expectedRevision: 'UUID' }     // compare-and-swap
{ mode: 'force' }                                // explicit unconditional replacement
```

Each consumer/key has an independent current manifest. `cameras/quad`,
`presets/demo`, and `dates/2026-11-05` are ordinary keys. The authenticated consumer
selects the namespace. An active lease returns `409 key_busy`, including for force.
Revision conflicts return `409 revision_conflict` and the current revision.

Captures are synchronous. A two-minute per-key lease fences publication; browser
operations have a shared 60-second budget after launch. The old image remains current
while a replacement runs or fails. Immutable image and manifest uploads precede an
atomic conditional current-pointer write. Expired captures cannot publish over a
new lease. Abandoned uploads can remain as unreferenced immutable artifacts.

An `Idempotency-Key` (8–100 letters/digits/underscores/hyphens) is required. Reusing it
with identical normalized input replays a completed response without rendering;
different input conflicts. Running requests return `409`; failures remain failed.
An expired request is not automatically retried: inspect current state, then submit
a fresh ID. After a network timeout, query status before deciding what to do next.
If publication succeeded but recording its result failed, status can recover it from
the current pointer while that revision is still current. A later replacement can
make that outcome indeterminate; always reconcile application state with the head.

No automatic cleanup or retention policy is configured. Keep published immutable
objects for as long as shared links need them; deleting request records also removes
their deduplication guarantee. Pinning is application metadata/policy, not enforced
by the service.

### Endpoints

| Endpoint                                  | Access         | Result                                              |
| ----------------------------------------- | -------------- | --------------------------------------------------- |
| `POST /v1/snapshots`                      | Consumer token | `201 {requestId, manifest, replayed}`; replay `200` |
| `GET /v1/requests/{id}`                   | Consumer token | running, expired, failed, or completed              |
| `GET /v1/manifests/{consumer}/{key}`      | Public         | Current manifest; `no-store`                        |
| `GET /v1/revisions/{consumer}/{revision}` | Public         | Immutable manifest                                  |
| `GET /images/{consumer}/{revision}.jpg`   | Public         | Immutable JPEG; ETag/304 support                    |

Missing objects return 404. Errors use `{error:{code,message,currentRevision?},requestId?}`.
Immutable responses cache for one year. Manifests contain revision, key, consumer,
creation time, image URL/dimensions, requested/source dimensions, and caller metadata;
they exclude capture URLs and private job/lease state. Do not put secrets in metadata.

## TypeScript client

Use `og-snap/client` from a local/package dependency, or import `src/client.ts`.
The client and public types have no Cloudflare runtime dependency. Use it server-side.

```ts
import { OgSnap } from "og-snap/client";

const snap = new OgSnap({ consumer: "days", token: env.OG_SNAP_TOKEN });
const requestId = crypto.randomUUID(); // persist before calling for timeout recovery
const result = await snap.capture(
    {
        key: "dates/2026-11-05",
        url: "https://days-next.ohn.sh/social/preview?day=2026-11-05",
        resolution: { width: 1600, height: 900 },
        metadata: { day: "2026-11-05", title: "A day in the archive" },
        publication: { mode: "create" },
    },
    requestId,
);

// Keep the returned revision for a later protected replacement:
const revision = result.manifest.revision;
const status = await snap.status(requestId);
const current = await snap.current("dates/2026-11-05");
```

No automatic capture retries. The client throws `OgSnapError` for API errors.
For Astro, emit `manifest.image.url` directly in `og:image`/`twitter:image` and
invalidate the affected cached page after publication. VOD retains its maintenance,
recording selection and pin rules, then submits selected captures with metadata.
