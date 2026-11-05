export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Metadata = { [key: string]: Json };
export interface Resolution {
  width: number;
  height: number;
}
export type Publication =
  | { mode: "create" }
  | { mode: "replace"; expectedRevision: string }
  | { mode: "force" };

export interface CaptureRequest<M extends Metadata = Metadata> {
  /** Opaque, slash-separated key within the authenticated consumer's namespace. */
  key: string;
  url: string;
  resolution?: Resolution;
  /** Entire viewport by default; otherwise capture one element. */
  selector?: string;
  /** An element which becomes visible when the application is ready. */
  readySelector?: string;
  errorSelector?: string;
  background?: string;
  metadata?: M;
  /** Defaults to create-only. */
  publication?: Publication;
}

export interface Manifest<M extends Metadata = Metadata> {
  schemaVersion: 1;
  consumer: string;
  key: string;
  revision: string;
  createdAt: string;
  image: { url: string; width: 1200; height: 630; contentType: "image/jpeg" };
  capture: { resolution: Resolution; source: Resolution };
  metadata: M;
}

export interface CaptureResult<M extends Metadata = Metadata> {
  requestId: string;
  manifest: Manifest<M>;
  replayed: boolean;
}

export interface ErrorBody {
  error: { code: string; message: string; currentRevision?: string | null };
  requestId?: string;
}

export type RequestStatus<M extends Metadata = Metadata> =
  | { status: "running" | "expired"; requestId: string }
  | { status: "completed"; requestId: string; manifest: Manifest<M> }
  | { status: "failed"; requestId: string; error: ErrorBody["error"] };

export interface ConsumerPolicy {
  /** Exact origin + pathname. Query strings vary per capture; redirects are rejected. */
  captureUrls: string[];
  resourceOrigins: string[];
}

export type NormalizedCapture = Required<Omit<CaptureRequest, "selector" | "errorSelector">> &
  Pick<CaptureRequest, "selector" | "errorSelector">;
