import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { OgSnap, OgSnapError, type CaptureRequest } from "./client";
import { captureWithJournal } from "./journal";
export { inspectJournal } from "./journal";

/** Node/Bun runner. Consumer wrappers own selection and post-publication cache purges. */
export async function runCapture(options: {
  client: OgSnap;
  request: Omit<CaptureRequest, "publication">;
  journalDirectory: string;
  onJournal?: (path: string) => void;
}) {
  let publication: CaptureRequest["publication"] = { mode: "create" };
  try {
    const current = await options.client.current(options.request.key, {
      signal: AbortSignal.timeout(10_000),
    });
    publication = { mode: "replace", expectedRevision: current.revision };
  } catch (error) {
    if (!(error instanceof OgSnapError && error.status === 404)) throw error;
  }
  await mkdir(options.journalDirectory, { recursive: true });
  const journalPath = resolve(options.journalDirectory, `${crypto.randomUUID()}.json`);
  options.onJournal?.(journalPath);
  try {
    const result = await captureWithJournal(
      options.client,
      { ...options.request, publication },
      journalPath,
      { signal: AbortSignal.timeout(120_000) },
    );
    return { ...result, journalPath };
  } catch (cause) {
    throw new Error(
      `Capture did not return successfully. Inspect journal ${journalPath} before retrying.`,
      { cause },
    );
  }
}
