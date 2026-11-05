import { expect, test } from "bun:test";
import { OgSnap, OgSnapError } from "../../src/client";

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
