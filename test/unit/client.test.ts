import { expect, test } from "bun:test";
import { OgSnap, OgSnapError } from "../../src/client";

test("public reads validate identity and image contract, preserve cancellation and omit credentials", async () => {
  const revision = crypto.randomUUID();
  const manifest = {
    schemaVersion: 1,
    consumer: "vod",
    key: "presets/default",
    revision,
    createdAt: new Date().toISOString(),
    image: {
      url: `https://og.ohn.sh/images/vod/${revision}.jpg`,
      width: 1200,
      height: 630,
      contentType: "image/jpeg",
      alt: "Camera",
    },
    capture: { resolution: { width: 1200, height: 630 }, source: { width: 1200, height: 630 } },
    metadata: {},
  };
  const signal = AbortSignal.timeout(1000);
  const client = new OgSnap({
    consumer: "vod",
    fetch: async (url, init) => {
      expect(String(url)).toBe("https://og.ohn.sh/v1/manifests/vod/presets/default");
      expect(init?.signal).toBe(signal);
      expect(init?.cache).toBe("no-store");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return Response.json(manifest);
    },
  });
  expect((await client.current("presets/default", { signal })).image.alt).toBe("Camera");
  manifest.key = "presets/demo";
  await expect(client.current("presets/default", { signal })).rejects.toThrow(
    "Invalid og-snap manifest",
  );
  manifest.key = "presets/default";
  manifest.image.url = "https://other.example/image.jpg";
  await expect(client.current("presets/default", { signal })).rejects.toThrow(
    "Invalid og-snap manifest",
  );
  expect(() => client.capture({ key: "test", url: "https://example.com" })).toThrow("token");
  expect(() => client.status("request-id")).toThrow("token");
});

test("client preserves explicit request ID, authentication and conditional publication without retries", async () => {
  let calls = 0;
  const client = new OgSnap({
    consumer: "vod",
    token: "private-token",
    fetch: async (url, init) => {
      calls++;
      expect(String(url)).toBe("https://og.ohn.sh/v1/snapshots");
      const headers = new Headers(init?.headers);
      expect(headers.get("Idempotency-Key")).toBe("request-client");
      expect(headers.get("Authorization")).toBe("Bearer private-token");
      expect(JSON.parse(init!.body as string).publication).toEqual({ mode: "force" });
      return Response.json({ error: { code: "key_busy", message: "Busy" } }, { status: 409 });
    },
  });
  await expect(
    client.capture(
      {
        key: "cameras/quad",
        url: "https://vod.ohn.sh/social/preview",
        publication: { mode: "force" },
      },
      "request-client",
    ),
  ).rejects.toBeInstanceOf(OgSnapError);
  expect(calls).toBe(1);
});
