import { timingSafeEqual } from "node:crypto";
import { SnapError } from "./errors";
import { capture, requestStatus } from "./service";
import { renderCapture } from "./render";
import { headKey, revisionKey, imageKey, r2Store, type Head } from "./store";
import {
  normalizeCapture,
  validConsumer,
  validKey,
  validRequestId,
  validRevision,
} from "./validation";
import type { ConsumerPolicy } from "./types";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
async function authenticate(request: Request, env: Env) {
  const consumer = request.headers.get("X-OG-Consumer") ?? "";
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  const tokens: Record<string, string> = JSON.parse(env.CONSUMER_TOKENS);
  const expected = Object.hasOwn(tokens, consumer) ? tokens[consumer] : "";
  const digest = async (text: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const [a, b] = await Promise.all([digest(token), digest(expected)]);
  if (
    !validConsumer(consumer) ||
    !token ||
    !expected ||
    !timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
  )
    throw new SnapError(401, "unauthorized", "Invalid consumer credentials");
  const policies: Record<string, ConsumerPolicy> = env.CONSUMERS;
  if (!Object.hasOwn(policies, consumer))
    throw new SnapError(403, "consumer_disabled", "Consumer is not configured");
  return { consumer, policy: policies[consumer] };
}
async function body(request: Request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json")
    throw new SnapError(415, "invalid_content_type", "Use application/json");
  if (!request.body) throw new SnapError(400, "invalid_request", "JSON body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new SnapError(413, "body_too_large", "Request exceeds 32 KiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SnapError(400, "invalid_request", "Invalid JSON");
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    let id: string | undefined;
    try {
      const path = new URL(request.url).pathname;
      const store = r2Store(env.SNAPSHOTS);
      if (path === "/v1/snapshots" && request.method === "POST") {
        const { consumer, policy } = await authenticate(request, env);
        id = request.headers.get("Idempotency-Key") ?? "";
        if (!validRequestId(id))
          throw new SnapError(
            400,
            "invalid_request",
            "Idempotency-Key must be 8–100 letters, digits, underscores or hyphens",
          );
        const input = normalizeCapture(await body(request), policy);
        const result = await capture(
          store,
          (value) => renderCapture(env.BROWSER, value, policy),
          consumer,
          id,
          input,
          new URL(env.PUBLIC_ORIGIN).origin,
        );
        return json(result, result.replayed ? 200 : 201);
      }
      if (request.method !== "GET" && request.method !== "HEAD")
        throw new SnapError(405, "method_not_allowed", "Method not allowed");
      const status = /^\/v1\/requests\/([a-zA-Z0-9_-]{8,100})$/.exec(path);
      if (status) {
        const { consumer } = await authenticate(request, env);
        return json(await requestStatus(store, consumer, status[1]));
      }
      const current = /^\/v1\/manifests\/([^/]+)\/(.+)$/.exec(path);
      if (current && validConsumer(current[1]) && validKey(current[2])) {
        const head = await store.read<Head>(headKey(current[1], current[2]));
        if (!head?.value.manifest) throw new SnapError(404, "not_found", "Manifest not found");
        return json(head.value.manifest);
      }
      const immutable = /^\/(images|v1\/revisions)\/([^/]+)\/([^/]+)$/.exec(path);
      if (immutable) {
        const image = immutable[1] === "images";
        const revision = image ? immutable[3].replace(/\.jpg$/, "") : immutable[3];
        if (
          !validConsumer(immutable[2]) ||
          !validRevision(revision) ||
          (image && !immutable[3].endsWith(".jpg"))
        )
          throw new SnapError(404, "not_found", "Not found");
        const object = await env.SNAPSHOTS.get(
          image ? imageKey(immutable[2], revision) : revisionKey(immutable[2], revision),
        );
        if (!object) throw new SnapError(404, "not_found", "Not found");
        const headers = new Headers({ "X-Content-Type-Options": "nosniff" });
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        if (request.headers.get("If-None-Match") === object.httpEtag)
          return new Response(null, { status: 304, headers });
        return new Response(request.method === "HEAD" ? null : object.body, { headers });
      }
      throw new SnapError(404, "not_found", "Not found");
    } catch (error) {
      if (error instanceof SnapError) return json(error.body(id), error.status);
      console.error(JSON.stringify({ event: "request_failed", requestId: id }));
      return json(new SnapError(500, "internal_error", "Request failed").body(id), 500);
    }
  },
} satisfies ExportedHandler<Env>;
