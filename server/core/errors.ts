export class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status } }
export const bad = (msg: string) => new HttpError(400, msg);
