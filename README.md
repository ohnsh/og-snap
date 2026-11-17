# og-snap (OpenGraph Snapshot)

A service, implemented as a Cloudflare Worker with a Browser Run backend, that
takes a browser snapshot of a given URL and saves it, along with a JSON
manifest, to an R2 bucket. Also provides a client helper library for consumers.
Snapshots are associated with client-defined key meant to be associated with
different routes—think slightly more abstract than a URL.

## Usage

Currently, this project ships with configuration very specific to my projects,
but there's a foundation here that could easily be generalized. Going forward,
most of my work here will be to that effect.

Consuming projects are authenticated using simple per-project tokens defined in
a git-ignored `secrets.json`. Here's what mine looks like:

```json
{
  "CONSUMER_TOKENS": "{\"vod\":\"RANDOM_VOD_TOKEN\",\"days\":\"RANDOM_DAYS_TOKEN\"}"
}
```

This project uses Cloudflare's `cf`, which if I'm not mistaken is the successor
to `wrangler`. Currently, `https://og.ohn.sh` is the hardcoded deployment
domain. It's also the default value of the `PUBLIC_ORIGIN` environment variable,
used to write snapshot URLs in JSON manifests.

```sh
bun run build
bunx cf deploy --prebuilt --mode production --secrets-file secrets.json
```

## Capture API

```sh
curl https://og.ohn.sh/v1/snapshots \
	-H 'X-OG-Consumer: vod' \
	-H "Authorization: Bearer $OG_SNAP_TOKEN" \
	-H 'Idempotency-Key: capture-20261105-quad-001' \
	-H 'Content-Type: application/json' \
	--data '{
    "key": "cameras/quad",
     "url": "https://vod.ohn.sh/social/preview?camera=quad",
     "alt": "Quad camera archive in the VOD player",
    "resolution": {"width":1200,"height":630},
    "readySelector": "#social-preview[data-preview-state=ready]",
    "errorSelector": "#social-preview[data-preview-state=error]",
    "selector": "#social-preview",
    "metadata": {"camera":"quad","pinned":true},
    "publication": {"mode":"create"}
  }'
```

## Details

See [agent-notes/usage.md](agent-notes/usage.md) for many more details.
