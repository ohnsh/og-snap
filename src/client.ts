import type {
  CaptureRequest,
  CaptureResult,
  ErrorBody,
  Manifest,
  Metadata,
  RequestStatus,
} from "./types";
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
    private options: { origin?: string; consumer: string; token: string; fetch?: typeof fetch },
  ) {
    this.origin = new URL(options.origin ?? "https://og.ohn.sh").origin;
  }
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await (this.options.fetch ?? fetch)(`${this.origin}${path}`, init);
    const value = await response.json();
    if (!response.ok) throw new OgSnapError(response.status, value as ErrorBody);
    return value as T;
  }
  private headers() {
    return {
      "X-OG-Consumer": this.options.consumer,
      Authorization: `Bearer ${this.options.token}`,
    };
  }
  capture<M extends Metadata>(
    input: CaptureRequest<M>,
    requestId = crypto.randomUUID(),
  ): Promise<CaptureResult<M>> {
    return this.request("/v1/snapshots", {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/json",
        "Idempotency-Key": requestId,
      },
      body: JSON.stringify(input),
    });
  }
  status<M extends Metadata = Metadata>(id: string): Promise<RequestStatus<M>> {
    return this.request(`/v1/requests/${encodeURIComponent(id)}`, { headers: this.headers() });
  }
  current<M extends Metadata = Metadata>(key: string): Promise<Manifest<M>> {
    return this.request(
      `/v1/manifests/${encodeURIComponent(this.options.consumer)}/${key.split("/").map(encodeURIComponent).join("/")}`,
    );
  }
}
