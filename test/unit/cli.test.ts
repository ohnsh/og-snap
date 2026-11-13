import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OgSnap } from "../../src/client";
import { runCapture } from "../../src/cli";

test("runner journals before capture, creates or conditionally replaces, and never retries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "og-runner-"));
  const revision = crypto.randomUUID();
  let journal = "";
  let exists = false;
  let captures = 0;
  const client = new OgSnap({
    consumer: "days",
    token: "secret",
    fetch: async (url, init) => {
      if (!init?.method) {
        expect(String(url)).toEndWith("/items/youtube%3Atest");
        if (!exists)
          return Response.json(
            { error: { code: "not_found", message: "Missing" } },
            { status: 404 },
          );
        return Response.json({
          schemaVersion: 1,
          consumer: "days",
          key: "items/youtube:test",
          revision,
          createdAt: new Date().toISOString(),
          metadata: {},
          image: {
            url: `https://og.ohn.sh/images/days/${revision}.jpg`,
            width: 1200,
            height: 630,
            contentType: "image/jpeg",
          },
          capture: {
            resolution: { width: 1200, height: 630 },
            source: { width: 1200, height: 630 },
          },
        });
      }
      captures++;
      const record = JSON.parse(await readFile(journal, "utf8"));
      expect(record.requestId).toBe(new Headers(init.headers).get("Idempotency-Key"));
      expect(record.input.publication).toEqual(
        exists ? { mode: "replace", expectedRevision: revision } : { mode: "create" },
      );
      expect(await readFile(journal, "utf8")).not.toContain("secret");
      return Response.json({ error: { code: "key_busy", message: "Busy" } }, { status: 409 });
    },
  });
  try {
    for (const value of [false, true]) {
      exists = value;
      await expect(
        runCapture({
          client,
          request: { key: "items/youtube:test", url: "https://days.ohn.sh/social/preview" },
          journalDirectory: directory,
          onJournal: (path) => {
            journal = path;
          },
        }),
      ).rejects.toThrow("Inspect journal");
    }
    expect(captures).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
