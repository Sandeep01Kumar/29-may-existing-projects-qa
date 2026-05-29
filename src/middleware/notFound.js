/**
 * 404 Not Found Middleware
 *
 * Terminal middleware that responds to any request that did not match a
 * registered route. It is mounted in `src/app.js` AFTER all feature routers
 * and BEFORE the centralized error handler, so the middleware pipeline reads:
 *
 *   express.json() -> requestLogger -> routes -> notFound -> errorHandler
 *
 * Because Express dispatches middleware in registration order, this handler
 * only runs when no upstream router accepted the request. It sends a small,
 * deterministic JSON payload with HTTP status 404 and does NOT leak any
 * internal state, stack traces, or path information back to the caller.
 *
 * Lineage: This explicit 404 behavior is derived from the decomposition of
 * the original `server.js` catch-all `http.createServer` handler, which
 * previously returned `Hello, World!\n` for every path. With routed handlers
 * now owning matched paths, this module owns the "no route matched" case.
 *
 * Design notes:
 *   - Exported as a bare 3-argument function so `app.use(notFound)`
 *     registers it directly without any factory call.
 *   - The `next` parameter is intentionally included to preserve the
 *     conventional Express middleware signature (`arity === 3`), but is not
 *     invoked: this is a terminal responder, not a pass-through.
 *   - The module has zero `require` dependencies — it relies solely on the
 *     `req`/`res` objects supplied by the host Express application at
 *     runtime, keeping it lightweight and trivial to test in isolation.
 *
 * @module src/middleware/notFound
 */

'use strict';

/**
 * Express middleware that finalizes the request with an HTTP 404 response.
 *
 * @param {import('express').Request}  req  Incoming HTTP request (unused).
 * @param {import('express').Response} res  Outgoing HTTP response.
 * @param {import('express').NextFunction} next  Next middleware (unused — this
 *   handler is terminal and intentionally does not call `next()` after
 *   sending the response).
 * @returns {void}
 */
const notFound = (req, res, next) => {
  res.status(404).json({ error: 'Not Found' });
};

module.exports = notFound;
