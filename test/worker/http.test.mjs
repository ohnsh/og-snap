import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Miniflare } from "miniflare";

test("built Worker authenticates, isolates request status, validates capture and serves R2", async () => {
  const dir = new URL("../../.cloudflare/output/v0/workers/default/", import.meta.url);
  const config = JSON.parse(await readFile(new URL("worker.config.json", dir), "utf8"));
  config.compatibilityDate = "2026-10-19"; // Installed local workerd's latest supported date.
  config.env.CONSUMER_TOKENS = {
    type: "text",
    value: JSON.stringify({ vod: "vod-secret", days: "days-secret" }),
  };
  config.manifest = {
    mainModule: config.manifest.mainModule,
    modules: {
      [config.manifest.mainModule]: {
        type: "esm",
        contents: await readFile(new URL(`bundle/${config.manifest.mainModule}`, dir), "utf8"),
      },
    },
  };
  const mf = new Miniflare({ workers: [{ config }] });
  const headers = {
    "X-OG-Consumer": "vod",
    Authorization: "Bearer vod-secret",
    "Content-Type": "application/json",
    "Idempotency-Key": "request-test",
  };
  const send = (path, init) => mf.dispatchFetch(`https://og.ohn.sh${path}`, init);
  try {
    assert.equal((await send("/v1/snapshots", { method: "POST" })).status, 401);
    assert.equal(
      (
        await send("/v1/snapshots", {
          method: "POST",
          headers,
          body: JSON.stringify({ key: "cameras/quad", url: "https://evil.example/preview" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (await send("/v1/snapshots", { method: "POST", headers, body: " ".repeat(32769) })).status,
      413,
    );
    const bucket = await mf.getR2Bucket("SNAPSHOTS");
    const revision = "12345678-1234-4123-8123-123456789012";
    const manifest = { revision, metadata: { camera: "quad" } };
    await bucket.put(
      "private/heads/vod/cameras/quad.json",
      JSON.stringify({ manifest, lease: { requestId: "private" } }),
    );
    await bucket.put(
      "private/requests/vod/request-test.json",
      JSON.stringify({ status: "completed", key: "cameras/quad", revision, manifest }),
    );
    assert.deepEqual(await (await send("/v1/manifests/vod/cameras/quad")).json(), manifest);
    await bucket.put("private/heads/days/items/youtube:abc-123.json", JSON.stringify({ manifest }));
    assert.deepEqual(
      await (await send("/v1/manifests/days/items/youtube%3Aabc-123")).json(),
      manifest,
    );
    assert.deepEqual(
      await (await send("/v1/manifests/days/items/youtube:abc-123")).json(),
      manifest,
    );
    assert.equal((await send("/v1/manifests/days/items%2Fyoutube:abc-123")).status, 400);
    assert.equal((await send("/v1/requests/request-test", { headers })).status, 200);
    assert.equal(
      (
        await send("/v1/requests/request-test", {
          headers: { "X-OG-Consumer": "days", Authorization: "Bearer days-secret" },
        })
      ).status,
      404,
    );
    assert.equal((await send("/private/heads/vod/cameras/quad.json")).status, 404);
    await bucket.put(`images/vod/${revision}.jpg`, new Uint8Array([1, 2, 3]), {
      httpMetadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const image = await send(`/images/vod/${revision}.jpg`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("Cache-Control"), /immutable/);
    assert.equal(
      (
        await send(`/images/vod/${revision}.jpg`, {
          headers: { "If-None-Match": image.headers.get("ETag") },
        })
      ).status,
      304,
    );
    // Actual R2 preconditions, including an ABA-resistant lease body.
    const first = await bucket.put("cas", "one", { onlyIf: { etagDoesNotMatch: "*" } });
    assert.equal(await bucket.put("cas", "two", { onlyIf: { etagDoesNotMatch: "*" } }), null);
    assert.ok(await bucket.put("cas", "two", { onlyIf: { etagMatches: first.etag } }));
    assert.equal(await bucket.put("cas", "stale", { onlyIf: { etagMatches: first.etag } }), null);
  } finally {
    await mf.dispose();
  }
});
