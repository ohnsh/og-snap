import type { ErrorBody, Manifest } from "./types";

export interface Head {
  manifest?: Manifest;
  lease?: { requestId: string; expiresAt: number };
}
export interface Job {
  fingerprint: string;
  key: string;
  revision: string;
  expiresAt: number;
  status: "running" | "completed" | "failed";
  manifest?: Manifest;
  error?: ErrorBody["error"];
  errorStatus?: number;
}
export interface Versioned<T> {
  value: T;
  etag: string;
}
export interface Store {
  read<T>(key: string): Promise<Versioned<T> | null>;
  /** Conditional JSON write. null means create-only; failed condition returns null. */
  write<T>(key: string, value: T, etag: string | null): Promise<string | null>;
  putImage(key: string, value: Uint8Array): Promise<void>;
  putManifest(key: string, value: Manifest): Promise<void>;
}
export const headKey = (consumer: string, key: string) => `private/heads/${consumer}/${key}.json`;
export const jobKey = (consumer: string, id: string) => `private/requests/${consumer}/${id}.json`;
export const imageKey = (consumer: string, revision: string) =>
  `images/${consumer}/${revision}.jpg`;
export const revisionKey = (consumer: string, revision: string) =>
  `manifests/${consumer}/${revision}.json`;

export function r2Store(bucket: R2Bucket): Store {
  return {
    async read<T>(key: string) {
      const object = await bucket.get(key);
      return object ? { value: await object.json<T>(), etag: object.etag } : null;
    },
    async write(key, value, etag) {
      const object = await bucket.put(key, JSON.stringify(value), {
        onlyIf: etag === null ? { etagDoesNotMatch: "*" } : { etagMatches: etag },
        httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
      });
      return object?.etag ?? null;
    },
    async putImage(key, value) {
      await bucket.put(key, value, {
        httpMetadata: {
          contentType: "image/jpeg",
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    },
    async putManifest(key, value) {
      await bucket.put(key, JSON.stringify(value), {
        httpMetadata: {
          contentType: "application/json",
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
    },
  };
}
