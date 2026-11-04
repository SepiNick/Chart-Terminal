export class HttpError extends Error {
  status: number; extra?: Record<string, unknown>;
  /** `extra` is merged into the JSON error body (e.g. the current revision of a conflicting write). */
  constructor(status: number, msg: string, extra?: Record<string, unknown>) { super(msg); this.status = status; this.extra = extra }
}
export const bad = (msg: string) => new HttpError(400, msg);
