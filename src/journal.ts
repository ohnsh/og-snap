import { readFile, writeFile } from "node:fs/promises";
import { OgSnap, OgSnapError } from "./client";
import type { CaptureRequest } from "./types";

/** Node/Bun-only durable request record. Tokens are never written to disk. */
export async function captureWithJournal(
  client: OgSnap,
  input: CaptureRequest,
  path: string,
  options: { signal?: AbortSignal } = {},
) {
  const requestId = crypto.randomUUID();
  await writeFile(path, JSON.stringify({ requestId, input }, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return client.capture(input, requestId, options);
}

/** Inspect both the request outcome and the current head after an interrupted call. */
export async function inspectJournal(client: OgSnap, path: string) {
  const record = JSON.parse(await readFile(path, "utf8"));
  if (typeof record.requestId !== "string" || typeof record.input?.key !== "string")
    throw new Error("Invalid og-snap request journal");
  const missing = (error: unknown): null => {
    if (error instanceof OgSnapError && error.status === 404) return null;
    throw error;
  };
  const status = await client.status(record.requestId).catch(missing);
  const current = await client.current(record.input.key).catch(missing);
  return { status, current };
}
