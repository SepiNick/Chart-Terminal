export class HttpError extends Error {
  status: number; extra?: Record<string, unknown>;
  /** `extra` is merged into the JSON error body (e.g. the current revision of a conflicting write). */
  constructor(status: number, msg: string, extra?: Record<string, unknown>) { super(msg); this.status = status; this.extra = extra }
}
export const bad = (msg: string) => new HttpError(400, msg);
/** Request-body guard: a plain JSON object (not null, not an array). */
export const obj = (x: unknown, what: string) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad(`${what} must be an object`); return x as Record<string, unknown> };
