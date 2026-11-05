import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OgSnap } from "../../src/client";
import { captureWithJournal, inspectJournal } from "../../src/journal";

test("journal precedes submission, survives connection loss and refuses overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "og-snap-journal-"));
  const path = join(directory, "request.json");
  let calls = 0;
  const input = { key: "presets/default", url: "https://example.com/preview", alt: "Camera" };
  const client = new OgSnap({
    consumer: "vod",
    token: "secret",
    fetch: async (_url, init) => {
      calls++;
      const journal = JSON.parse(await readFile(path, "utf8"));
      expect(journal.input).toEqual(input);
      expect(journal.requestId).toBe(new Headers(init?.headers).get("Idempotency-Key"));
      expect(await readFile(path, "utf8")).not.toContain("secret");
      throw new Error("Connection lost");
    },
  });
  try {
    await expect(captureWithJournal(client, input, path)).rejects.toThrow("Connection lost");
    await expect(captureWithJournal(client, input, path)).rejects.toThrow();
    expect(calls).toBe(1);
    const lookup = new OgSnap({
      consumer: "vod",
      token: "secret",
      fetch: async (_url, init) => {
        expect(init?.method ?? "GET").toBe("GET");
        return Response.json({ error: { code: "not_found", message: "Missing" } }, { status: 404 });
      },
    });
    expect(await inspectJournal(lookup, path)).toEqual({ status: null, current: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
