/**
 * Centralized Error-Handling Middleware
 *
 * Terminal four-argument Express middleware that normalizes any error
 * propagated through the request/response pipeline into a structured JSON
 * response, while logging the full diagnostic context to the server-side
 * winston logger. It is the LAST middleware mounted in `src/app.js`:
 *
 *   express.json() -> requestLogger -> routes -> notFound -> errorHandler
 *
 * Because Express dispatches middleware in registration order, this handler
 * runs only when a preceding layer either threw synchronously, called
 * `next(err)` explicitly, or rejected a returned promise (Express 5).
 *
 * Why exactly four parameters
 * ---------------------------
 * Express identifies error-handling middleware by FUNCTION ARITY: a callback
 * registered with `app.use(fn)` is treated as an error handler if and only
 * if `fn.length === 4`. The four formal parameters `(err, req, res, next)`
 * MUST therefore all be present in the signature, even though the `next`
 * parameter is intentionally unused — this handler is terminal and finalizes
 * the response itself rather than delegating to a downstream layer. Removing
 * `next` (or any other parameter) silently demotes the function to a regular
 * 3-argument middleware and Express will refuse to dispatch errors to it.
 *
 * Response contract
 * -----------------
 *   - HTTP status — resolved in two phases:
 *       (a) RAW: `err.status` -> `err.statusCode` -> `500` (first defined).
 *           This precedence honors the de-facto convention used by
 *           `http-errors` and most Express ecosystem libraries that surface
 *           either property.
 *       (b) NORMALIZED: the raw status is coerced to a valid HTTP error code
 *           in `[400, 599]`. Anything that is not an integer in that range
 *           (non-numeric, fractional, < 400, > 599, NaN, etc.) is replaced
 *           with `500`. This prevents malformed error objects from causing
 *           Express to emit non-standard or success-range status codes for
 *           what is, by virtue of having reached this handler, an error.
 *   - Body: `{ "error": <safeMessage> }` JSON. The `<safeMessage>` chosen
 *     enforces a strict information-disclosure boundary (AAP §0.7 production
 *     hardening, Rule §0.7 "Error response safety"):
 *       * For status >= 500 (server errors), the body NEVER contains
 *         `err.message` — it surfaces the canonical RFC 7231/IANA status
 *         text (`http.STATUS_CODES[status]`), e.g., `'Internal Server Error'`.
 *         This blocks accidental leakage of filesystem paths, ORM details,
 *         third-party library internals, and similar reconnaissance signals
 *         that may appear in `err.message` for native runtime failures
 *         (`ENOENT`, `ECONNREFUSED`, JSON parse errors raised in business
 *         logic, etc.).
 *       * For status < 500 (client errors), `err.message` is surfaced ONLY
 *         when the error explicitly opts in via `err.expose === true` — the
 *         http-errors ecosystem convention used by libraries that
 *         deliberately produce client-safe error text (e.g.,
 *         `express.json()` body-parser BadRequestErrors). Errors WITHOUT
 *         this explicit opt-in (plain `new Error('...')`, `err.expose` left
 *         undefined or set to false) fall back to the canonical status text
 *         and therefore CANNOT leak their message — a default-deny stance
 *         that keeps the surface tight without requiring every call site to
 *         remember a sanitizer.
 *     The response deliberately omits `err.stack`, `err.code`, request echo,
 *     and any other internal field for ALL paths, regardless of status.
 *
 * Logging contract
 * ----------------
 * The full stack trace (preferred) or message (fallback) is recorded via
 * `logger.error(...)` from `src/utils/logger.js`. The winston instance is
 * the single source of truth for application logs and shares its transport
 * configuration with the morgan HTTP access stream, so error records appear
 * in the same destinations as request logs and startup messages. Note:
 * stack traces stay in server logs ONLY — they are never echoed in the
 * outbound HTTP response.
 *
 * Lineage
 * -------
 * The legacy `server.js` (L6-L10) was a single static handler with NO error
 * path — it returned `Hello, World!\n` for every request. With the Express
 * adoption introduced by this feature (AAP §0.1.2 project rule mandating
 * middleware), centralized error handling becomes a net-new cross-cutting
 * concern that this module fully owns.
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per the AAP §0.7 repository
 * convention. The export is the bare 4-argument function so that
 * `app.use(errorHandler)` registers it directly without an intermediate
 * factory call.
 *
 * @module src/middleware/errorHandler
 */

'use strict';

// Built-in Node HTTP module — used solely for its `STATUS_CODES` table, which
// maps numeric HTTP status codes to their canonical RFC 7231 / IANA reason
// phrases (e.g., 400 -> 'Bad Request', 404 -> 'Not Found', 500 -> 'Internal
// Server Error'). Using this table — instead of inlining the strings — gives
// us a single, authoritative source for safe response messages that already
// covers every status this handler is permitted to emit. No socket is opened
// by this import; `http.STATUS_CODES` is a plain object on the module.
const http = require('http');

// The winston logger instance is imported from the sibling `src/utils/`
// folder. `src/utils/logger.js` exports the configured winston instance
// directly (no wrapper object), so `.error(...)` is invoked straight on the
// imported binding. The relative path `'../utils/logger'` resolves against
// this file's location at `src/middleware/errorHandler.js`.
const logger = require('../utils/logger');

// Generic, client-safe message used whenever (a) the response status is in
// the 5xx range, (b) the error explicitly suppresses exposure
// (`err.expose === false` or simply `err.expose !== true`), or (c) the
// canonical RFC text for the resolved status is somehow unavailable. The
// literal matches `http.STATUS_CODES[500]` and is also the conventional
// generic-failure message used by Node's built-in error responses, so it
// stays consistent with the rest of the platform.
const GENERIC_ERROR_MESSAGE = 'Internal Server Error';

/**
 * Express terminal error-handling middleware.
 *
 * Logs the error server-side and finalizes the HTTP response with a JSON
 * payload chosen to satisfy a strict information-disclosure boundary (no
 * stack, no internal message leakage for 5xx, gated message exposure for
 * 4xx). See the module header's "Response contract" for the full safety
 * rules.
 *
 * Behavior summary
 * ----------------
 *   1. Logs `err.stack || err.message` via the shared winston logger at the
 *      `error` level. Server-side logs receive the FULL diagnostic context;
 *      the outbound response NEVER does.
 *   2. Resolves the response status from `err.status` -> `err.statusCode` ->
 *      `500`, then NORMALIZES it: any value that is not an integer in the
 *      `[400, 599]` range is replaced with `500`. This is what makes the
 *      handler safe against non-standard or malformed status overrides
 *      (e.g., `err.status = 999`, `err.status = 'bad'`, fractional values).
 *   3. Chooses a SAFE response message:
 *        * If the (normalized) status is >= 500, the message is ALWAYS the
 *          canonical RFC text (`http.STATUS_CODES[status]`) and `err.message`
 *          is never surfaced.
 *        * If the status is in the 4xx range AND `err.expose === true`, the
 *          original `err.message` is surfaced (this is the http-errors
 *          opt-in used by `express.json()`'s BadRequestError and similar
 *          libraries that intentionally produce client-safe text).
 *        * Otherwise (4xx without an explicit `err.expose === true` opt-in)
 *          the canonical RFC text is used and `err.message` is suppressed.
 *   4. Sends the JSON body `{ error: <safeMessage> }`.
 *
 * @param {Error & { status?: number, statusCode?: number, expose?: boolean }} err
 *   The error forwarded by an upstream middleware or route handler. Any
 *   object whose prototype chain leads to `Error` is supported; the
 *   optional numeric `status` / `statusCode` and boolean `expose`
 *   properties drive the response status and the message-exposure gate
 *   when present. Anything else (plain objects, strings via `throw 'x'`,
 *   etc.) is handled defensively: missing fields fall through to the safe
 *   defaults rather than crashing the handler.
 * @param {import('express').Request}      req   Incoming HTTP request (unused
 *   in the response body, but supplied by Express for signature compliance
 *   and available for future enrichment such as correlation IDs).
 * @param {import('express').Response}     res   Outgoing HTTP response. Must
 *   support Express's `.status(code).json(body)` chain (which is provided
 *   automatically when the handler is mounted on an `express()` app).
 * @param {import('express').NextFunction} next  Next middleware in the stack
 *   (UNUSED but REQUIRED: removing this parameter would change the function
 *   arity to 3 and Express would no longer treat this as an error handler).
 * @returns {void}
 */
const errorHandler = (err, req, res, next) => {
  // 1) Server-side logging — prefer the full stack for diagnostic richness;
  // if the upstream code threw a non-Error value or a sparse error object
  // that lacks `.stack`, fall back to the message so something useful is
  // always recorded. The stack/message remain confined to the server log
  // destination (via the shared winston logger) and are intentionally NOT
  // included in the outbound response body, regardless of status. This
  // preserves on-call/post-mortem diagnostic capability while preventing
  // any of the same content from reaching the client.
  logger.error(err.stack || err.message);

  // 2) Resolve the RAW HTTP status from the error object using the
  // conventional precedence used by popular libraries:
  //   1. `err.status`     — preferred field on `http-errors`-style objects
  //   2. `err.statusCode` — common alias produced by other ecosystem libs
  //   3. `500`            — safe default for any unrecognized failure mode
  const rawStatus = err.status || err.statusCode || 500;

  // 3) NORMALIZE the status. Anything that is not a finite integer in the
  // valid HTTP-error range `[400, 599]` is coerced to `500`. This handles:
  //   - non-numeric values (e.g., `err.status = 'bad'`)
  //   - non-integers (e.g., `err.status = 404.5`)
  //   - NaN / Infinity from arithmetic on tainted error fields
  //   - out-of-range integers (e.g., 100/200/300/700)
  // The result is that the response status is ALWAYS a valid HTTP error
  // code, even if the error object was malformed or hostile. Number.isInteger
  // returns false for NaN and Infinity, so those cases are caught implicitly.
  const status =
    Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
      ? rawStatus
      : 500;

  // 4) Decide whether `err.message` may be surfaced in the response body.
  //
  // The http-errors ecosystem convention is that `err.expose === true`
  // marks an error's message as client-safe. The body-parser middleware
  // shipped with Express 5 (`express.json()`) sets `expose: true` on its
  // BadRequestError when the request body is malformed, so the original
  // parse error message can flow through to the client unchanged in that
  // case. Errors WITHOUT `expose === true` (plain Errors thrown by route
  // code, runtime failures, third-party library errors) are treated as
  // server-internal and have their messages suppressed.
  //
  // The 5xx range short-circuits this gate — a server-error status is
  // taken as definitive proof that the message is unsafe to expose, even
  // if the error happens to set `expose: true`. This guards against
  // misconfigured errors (e.g., a library that sets expose=true on its
  // own internal failures).
  const canExposeMessage = status < 500 && err.expose === true;

  // 5) Compute the final response message. When the message may be
  // surfaced, prefer `err.message`; otherwise use the canonical RFC 7231
  // status text from `http.STATUS_CODES`. The two final-fallback paths
  // (empty message on an exposed 4xx; missing STATUS_CODES entry) both
  // resolve to the same `GENERIC_ERROR_MESSAGE` literal so the response
  // is well-formed under every code path.
  const safeMessage = canExposeMessage
    ? (err.message || http.STATUS_CODES[status] || GENERIC_ERROR_MESSAGE)
    : (http.STATUS_CODES[status] || GENERIC_ERROR_MESSAGE);

  // 6) Finalize the response with a small, deterministic JSON body. Only
  // the `error` field is exposed — no `stack`, no `code`, no environment
  // hints, no request echo — keeping the surface minimal to avoid leaking
  // server internals to untrusted callers (AAP §0.7 production hardening).
  res.status(status).json({ error: safeMessage });
};

module.exports = errorHandler;
