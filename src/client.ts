import type {
  CaptureRequest,
  CaptureResult,
  ErrorBody,
  Manifest,
  Metadata,
  RequestStatus,
} from "./types";
import { parseManifest } from "./manifest";
export type * from "./types";

export class OgSnapError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error.message);
  }
}
/** Server-side client: never expose a consumer token in browser code. No automatic retries. */
export class OgSnap {
  private origin: string;
  constructor(
    private options: { origin?: string; consumer: string; token?: string; fetch?: typeof fetch },
  ) {
    this.origin = new URL(options.origin ?? "https://og.ohn.sh").origin;
  }
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(`${this.origin}${path}`, init);
    const value = await response.json().catch(() => {
      throw new Error(`og-snap returned non-JSON response (${response.status})`);
    });
    if (!response.ok) throw new OgSnapError(response.status, value as ErrorBody);
    return value as T;
  }
  private headers() {
    if (!this.options.token) throw new Error("An og-snap consumer token is required");
    return {
      "X-OG-Consumer": this.options.consumer,
      Authorization: `Bearer ${this.options.token}`,
    };
  }
  capture<M extends Metadata>(
    input: CaptureRequest<M>,
    requestId = crypto.randomUUID(),
    options: { signal?: AbortSignal } = {},
  ): Promise<CaptureResult<M>> {
    return this.request("/v1/snapshots", {
      method: "POST",
      signal: options.signal,
      headers: {
        ...this.headers(),
        "Content-Type": "application/json",
        "Idempotency-Key": requestId,
      },
      body: JSON.stringify(input),
    });
  }
  status<M extends Metadata = Metadata>(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<RequestStatus<M>> {
    return this.request(`/v1/requests/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      signal: options.signal,
    });
  }
  async current<M extends Metadata = Metadata>(
    key: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<Manifest<M>> {
    const value = await this.request<unknown>(
      `/v1/manifests/${encodeURIComponent(this.options.consumer)}/${key.split("/").map(encodeURIComponent).join("/")}`,
      { signal: options.signal, cache: "no-store" },
    );
    return parseManifest<M>(value, { origin: this.origin, consumer: this.options.consumer, key });
  }
}
