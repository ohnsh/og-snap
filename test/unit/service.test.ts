import { expect, test } from "bun:test";
import { capture, requestStatus } from "../../src/service";
import { headKey, jobKey, type Store } from "../../src/store";
import { normalizeCapture } from "../../src/validation";

const policy = {
  captureUrls: ["https://example.com/preview"],
  resourceOrigins: ["https://example.com"],
};
const input = (extra = {}) =>
  normalizeCapture({ key: "cameras/quad", url: "https://example.com/preview", ...extra }, policy);
function fixture() {
  let sequence = 0;
  const data = new Map<string, { value: unknown; etag: string }>();
  const store: Store = {
    async read(key) {
      return structuredClone(data.get(key) ?? null) as Awaited<ReturnType<Store["read"]>>;
    },
    async write(key, value, etag) {
      if ((data.get(key)?.etag ?? null) !== etag) return null;
      const tag = String(++sequence);
      data.set(key, { value: structuredClone(value), etag: tag });
      return tag;
    },
    async putImage() {},
    async putManifest() {},
  };
  let calls = 0;
  const render = async () => {
    calls++;
    return { bytes: new Uint8Array([1]), source: { width: 1200, height: 865 } };
  };
  const run = (id: string, value = input(), consumer = "vod", renderer = render) =>
    capture(store, renderer, consumer, id, value, "https://og.ohn.sh");
  return { store, data, run, render, calls: () => calls };
}

test("metadata, isolated keys/consumers, revision checks and idempotent replay", async () => {
  const f = fixture();
  const request = input({ metadata: { camera: "quad", pinned: true } });
  const first = await f.run("request-1", request);
  expect(first.manifest.metadata).toEqual(request.metadata);
  expect(first.manifest.image.width).toBe(1200);
  expect((await f.run("request-1", request)).replayed).toBe(true);
  expect(f.calls()).toBe(1);
  await expect(f.run("request-1")).rejects.toMatchObject({ code: "idempotency_conflict" });
  await expect(f.run("request-2")).rejects.toMatchObject({ code: "revision_conflict" });
  const next = await f.run(
    "request-3",
    input({ publication: { mode: "replace", expectedRevision: first.manifest.revision } }),
  );
  await expect(
    f.run(
      "request-4",
      input({ publication: { mode: "replace", expectedRevision: first.manifest.revision } }),
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(next.manifest.revision).not.toBe(first.manifest.revision);
  await f.run("request-1", input(), "days");
  await f.run("request-5", input({ key: "presets/demo" }));
});

test("concurrent requests launch once; expired capture cannot overwrite newer publication", async () => {
  const f = fixture();
  let finish!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const old = f.run("request-old", input(), "vod", async () => {
    started();
    await pending;
    return f.render();
  });
  await ready;
  await expect(
    f.run("request-busy", input({ publication: { mode: "force" } })),
  ).rejects.toMatchObject({ code: "key_busy" });
  const key = headKey("vod", "cameras/quad");
  const head = await f.store.read<{ lease: { expiresAt: number } }>(key);
  head!.value.lease.expiresAt = 0;
  await f.store.write(key, head!.value, head!.etag);
  const newer = await f.run("request-new", input({ publication: { mode: "force" } }));
  finish();
  await expect(old).rejects.toMatchObject({ code: "lease_lost" });
  expect(
    (await f.store.read<{ manifest: { revision: string } }>(key))!.value.manifest.revision,
  ).toBe(newer.manifest.revision);
});

test("failed rendering preserves current image and failed request never re-renders", async () => {
  const f = fixture();
  const first = await f.run("request-first");
  const request = input({ publication: { mode: "force" } });
  await expect(
    f.run("request-fail", request, "vod", async () => {
      throw new Error("private details");
    }),
  ).rejects.toMatchObject({ code: "capture_failed" });
  await expect(f.run("request-fail", request)).rejects.toMatchObject({ code: "capture_failed" });
  expect(f.calls()).toBe(1);
  expect(
    (await f.store.read<{ manifest: { revision: string } }>(headKey("vod", request.key)))!.value
      .manifest.revision,
  ).toBe(first.manifest.revision);
  await f.run("request-retry", request);
});

test("validation rejects unsafe targets, malformed publication and excessive metadata", () => {
  for (const extra of [
    { url: "https://example.com/other" },
    { url: "http://example.com/preview" },
    { url: "https://token@example.com/preview" },
    { key: "../other" },
    { resolution: { width: 4000, height: 1000 } },
    { resolution: { width: 800 } },
    { background: "red;display:none" },
    { publication: { mode: "replace" } },
    { metadata: { text: "a".repeat(16384) } },
    { unexpected: true },
  ])
    expect(() => input(extra)).toThrow();
  expect(input({ url: "https://example.com/preview?day=2026-11-05" }).url).toContain("?day=");
});

test("status recovers a published head and expired jobs never launch again", async () => {
  const f = fixture();
  const result = await f.run("request-recover");
  const key = jobKey("vod", "request-recover");
  const job = await f.store.read<Record<string, unknown>>(key);
  delete job!.value.manifest;
  job!.value.status = "running";
  job!.value.expiresAt = 0;
  await f.store.write(key, job!.value, job!.etag);
  expect(await requestStatus(f.store, "vod", "request-recover")).toMatchObject({
    status: "completed",
    manifest: { revision: result.manifest.revision },
  });
  expect((await f.run("request-recover")).replayed).toBe(true);
  await f.run("request-replace", input({ publication: { mode: "force" } }));
  expect(await requestStatus(f.store, "vod", "request-recover")).toMatchObject({
    status: "expired",
  });
  await expect(f.run("request-recover")).rejects.toMatchObject({ code: "request_expired" });
  expect(f.calls()).toBe(2);
});
