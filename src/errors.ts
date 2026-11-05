import type { ErrorBody } from "./types";

export class SnapError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly currentRevision?: string | null,
  ) {
    super(message);
  }
  body(requestId?: string): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.currentRevision !== undefined ? { currentRevision: this.currentRevision } : {}),
      },
      ...(requestId ? { requestId } : {}),
    };
  }
}
