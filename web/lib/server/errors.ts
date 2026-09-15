/**
 * `RequestError` — a refusal with everything an HTTP response needs, thrown from deep and caught
 * at the route.
 *
 * It lives in its own module, apart from `http.ts`, for one reason: `verification.ts` throws it,
 * and `verification.ts` must stay free of anything server-only so that the `/verify` page can
 * import its types and schemas without dragging `lib/server/env.ts` — and therefore
 * `REGISTRAR_PRIVATE_KEY` — into a client bundle. This file imports a type and nothing else.
 *
 * The `code` values are Phase 6's `apiErrorCode` enum, unchanged. Adding one would be a breaking
 * change for a partner switching on it, so an unauthorised call is HTTP 401 with code
 * `bad_request` and a message that says precisely what is wrong. The status carries the meaning.
 */

import type { ApiErrorCode } from "../schemas";

export class RequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly hint: string;

  constructor(code: ApiErrorCode, status: number, message: string, hint: string) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.status = status;
    this.hint = hint;
  }

  static badRequest(message: string, hint: string): RequestError {
    return new RequestError("bad_request", 400, message, hint);
  }

  static unauthorized(message: string, hint: string): RequestError {
    return new RequestError("bad_request", 401, message, hint);
  }

  static tooManyRequests(message: string, hint: string): RequestError {
    return new RequestError("bad_request", 429, message, hint);
  }
}
