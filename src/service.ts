import { SnapError } from "./errors";
import { headKey, jobKey, imageKey, revisionKey, type Store, type Head, type Job } from "./store";
import { fingerprint } from "./validation";
import type {
  CaptureResult,
  Manifest,
  NormalizedCapture,
  Resolution,
  RequestStatus,
} from "./types";

export type Renderer = (
  request: NormalizedCapture,
) => Promise<{ bytes: Uint8Array; source: Resolution }>;
const leaseMs = 120_000;

export async function requestStatus(
  store: Store,
  consumer: string,
  id: string,
): Promise<RequestStatus> {
  const job = await store.read<Job>(jobKey(consumer, id));
  if (!job) throw new SnapError(404, "not_found", "Request not found");
  const head = await store.read<Head>(headKey(consumer, job.value.key));
  const manifest =
    job.value.manifest ??
    (head?.value.manifest?.revision === job.value.revision ? head.value.manifest : undefined);
  if (manifest) return { status: "completed", requestId: id, manifest };
  if (job.value.status === "failed")
    return { status: "failed", requestId: id, error: job.value.error! };
  return { status: job.value.expiresAt <= Date.now() ? "expired" : "running", requestId: id };
}

export async function capture(
  store: Store,
  render: Renderer,
  consumer: string,
  id: string,
  input: NormalizedCapture,
  origin: string,
): Promise<CaptureResult> {
  const hash = await fingerprint(input);
  const jk = jobKey(consumer, id);
  const hk = headKey(consumer, input.key);
  const job: Job = {
    fingerprint: hash,
    key: input.key,
    revision: crypto.randomUUID(),
    expiresAt: Date.now() + leaseMs,
    status: "running",
  };
  const jobTag = await store.write(jk, job, null);
  if (!jobTag) {
    const prior = await store.read<Job>(jk);
    if (prior?.value.fingerprint !== hash)
      throw new SnapError(409, "idempotency_conflict", "Request ID was used for different input");
    const status = await requestStatus(store, consumer, id);
    if (status.status === "completed")
      return { requestId: id, manifest: status.manifest, replayed: true };
    if (status.status === "failed")
      throw new SnapError(
        prior.value.errorStatus ?? 502,
        status.error.code,
        status.error.message,
        status.error.currentRevision,
      );
    throw new SnapError(
      409,
      `request_${status.status}`,
      status.status === "expired"
        ? "Inspect the current manifest and submit a new request ID"
        : "Request is already running",
    );
  }
  let leaseTag: string | null = null;
  let previous: Head = {};
  let published = false;
  try {
    const current = await store.read<Head>(hk);
    previous = current?.value ?? {};
    const revision = previous.manifest?.revision ?? null;
    if (previous.lease && previous.lease.expiresAt > Date.now())
      throw new SnapError(409, "key_busy", "A capture for this key is running", revision);
    if (
      (input.publication.mode === "create" && revision !== null) ||
      (input.publication.mode === "replace" && revision !== input.publication.expectedRevision)
    )
      throw new SnapError(
        409,
        "revision_conflict",
        "Current revision does not match publication condition",
        revision,
      );
    leaseTag = await store.write(
      hk,
      { ...previous, lease: { requestId: id, expiresAt: job.expiresAt } },
      current?.etag ?? null,
    );
    if (!leaseTag) throw new SnapError(409, "key_busy", "Another request claimed this key");
    const result = await render(input);
    const manifest: Manifest = {
      schemaVersion: 1,
      consumer,
      key: input.key,
      revision: job.revision,
      createdAt: new Date().toISOString(),
      image: {
        url: `${origin}/images/${consumer}/${job.revision}.jpg`,
        width: 1200,
        height: 630,
        contentType: "image/jpeg",
      },
      capture: { resolution: input.resolution, source: result.source },
      metadata: input.metadata,
    };
    await store.putImage(imageKey(consumer, job.revision), result.bytes);
    await store.putManifest(revisionKey(consumer, job.revision), manifest);
    if (Date.now() >= job.expiresAt || !(await store.write(hk, { manifest }, leaseTag)))
      throw new SnapError(
        409,
        "lease_lost",
        "Capture expired or was superseded; inspect the current manifest",
      );
    published = true;
    await store.write(jk, { ...job, status: "completed", manifest }, jobTag);
    return { requestId: id, manifest, replayed: false };
  } catch (error) {
    // A publication followed by a storage failure is recoverable from the head.
    if (!published) {
      const safe =
        error instanceof SnapError ? error : new SnapError(502, "capture_failed", "Capture failed");
      if (leaseTag)
        await store.write(
          hk,
          { ...(previous.manifest ? { manifest: previous.manifest } : {}) },
          leaseTag,
        );
      await store.write(
        jk,
        { ...job, status: "failed", error: safe.body().error, errorStatus: safe.status },
        jobTag,
      );
      throw safe;
    }
    throw new SnapError(503, "status_unavailable", "Publication succeeded; query request status");
  }
}
