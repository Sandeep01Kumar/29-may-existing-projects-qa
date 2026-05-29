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
 *   - HTTP status: `err.status` -> `err.statusCode` -> `500` (first defined).
 *     This precedence honors the de-facto convention used by `http-errors`
 *     and most Express ecosystem libraries that surface either property.
 *   - Body: `{ "error": <message> }` JSON, where `<message>` defaults to
 *     `'Internal Server Error'` when `err.message` is falsy. The response
 *     deliberately omits `err.stack` and any other internal fields to avoid
 *     leaking server internals to untrusted callers (AAP §0.7 production
 *     hardening).
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

// The winston logger instance is imported from the sibling `src/utils/`
// folder. `src/utils/logger.js` exports the configured winston instance
// directly (no wrapper object), so `.error(...)` is invoked straight on the
// imported binding. The relative path `'../utils/logger'` resolves against
// this file's location at `src/middleware/errorHandler.js`.
const logger = require('../utils/logger');

/**
 * Express terminal error-handling middleware.
 *
 * Logs the error server-side and finalizes the HTTP response with a JSON
 * payload that surfaces ONLY the error message — never the stack trace or
 * any other internal field.
 *
 * @param {Error & { status?: number, statusCode?: number }} err
 *   The error forwarded by an upstream middleware or route handler. Any
 *   object whose prototype chain leads to `Error` is supported; the
 *   optional `status` / `statusCode` numeric properties drive the HTTP
 *   response status when present.
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
  // Server-side logging: prefer the full stack for diagnostic richness; if
  // the upstream code threw a non-Error value or a sparse error object that
  // lacks `.stack`, fall back to the message so something useful is always
  // recorded. The stack remains confined to the server log destination and
  // is intentionally NOT included in the outbound response body.
  logger.error(err.stack || err.message);

  // Resolve the HTTP status from the error object, honoring the conventional
  // precedence used by popular libraries:
  //   1. `err.status`     — preferred field on `http-errors`-style objects
  //   2. `err.statusCode` — common alias produced by other ecosystem libs
  //   3. `500`            — safe default for any unrecognized failure mode
  const status = err.status || err.statusCode || 500;

  // Finalize the response with a small, deterministic JSON body. Only the
  // `error` field is exposed — no `stack`, no `code`, no environment hints,
  // no request echo — keeping the surface minimal to avoid leaking server
  // internals to untrusted callers (AAP §0.7 production hardening).
  res.status(status).json({ error: err.message || 'Internal Server Error' });
};

module.exports = errorHandler;
