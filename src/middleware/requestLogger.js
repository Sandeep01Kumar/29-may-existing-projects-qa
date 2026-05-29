/**
 * HTTP Request Access-Logging Middleware (morgan → winston)
 *
 * Bridges `morgan` HTTP access logging into the application-wide `winston`
 * logger so that HTTP access lines and application logs share a single
 * transport configuration. It is registered in `src/app.js` AFTER body
 * parsing and BEFORE the feature routers, so the full pipeline reads:
 *
 *   express.json() -> requestLogger -> routes -> notFound -> errorHandler
 *
 * Role in the AAP
 * ---------------
 * Fulfills BOTH the "middleware" and "logging" capabilities mandated by the
 * project rule (AAP §0.1.2) and the cross-folder integration described in
 * AAP §0.2.2 / §0.5.2 — namely, "the standard pattern of piping morgan HTTP
 * access logs through a winston write stream is applied so application and
 * access logs share one transport configuration."
 *
 * How the pipe works
 * ------------------
 * `morgan('combined', { stream })` returns a bare Express middleware that,
 * for every completed request/response cycle, formats an Apache "combined"
 * access-log line (remote-addr, user, time, request line, status, bytes,
 * referer, user-agent) and calls `stream.write(line)` with a trailing
 * newline. The shared `logger.stream` exposed by `src/utils/logger.js` is
 * exactly that stream — its `write(message)` implementation trims the
 * trailing newline (winston adds its own) and forwards the line through the
 * winston logger at the `info` level, so HTTP access records share the
 * same Console (and any future File) transports as the application's
 * other `info`, `error`, etc. records. Emitting at `info` (rather than
 * winston's `http` level) ensures the access lines remain observable under
 * the documented default `LOG_LEVEL=info` — `http` records are filtered out
 * at that threshold under winston's npm levels, so routing morgan through
 * `info` is what keeps the observability mandate (AAP §0.1.2) intact. The
 * full rationale lives at the `logger.stream` definition in
 * `src/utils/logger.js`; access records remain identifiable by their
 * Apache-combined line format, so no information is lost by sharing the
 * `info` severity bucket.
 *
 * Format choice — "combined"
 * --------------------------
 * The Apache "combined" preset is selected because it is the de-facto
 * standard production-grade access-log format and is the form most log
 * aggregators (and a PM2 deployment, per AAP §0.1.2) understand without
 * additional parsing rules. It is a strict superset of the "common" preset.
 *
 * Lineage
 * -------
 * Derived from the observability seam of the legacy `server.js` — the lone
 * `console.log` startup line at L13. That single, unstructured log site is
 * superseded by structured `winston` application logging (in
 * `src/utils/logger.js`), and this middleware layers HTTP access logging on
 * top of that same logger so the migration to Express does not regress
 * observability.
 *
 * Export shape
 * ------------
 * The export is the BARE Express middleware function produced by `morgan`,
 * not a factory or a wrapper object. Consumers register it directly:
 *
 *   const requestLogger = require('./middleware/requestLogger');
 *   app.use(requestLogger);
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per the AAP §0.7 repository
 * convention — matches the existing `server.js` style and every other
 * module in the project. No ESM syntax.
 *
 * @module src/middleware/requestLogger
 */

'use strict';

// External: HTTP request access-logging middleware factory. Declared as a
// runtime dependency at the pinned version morgan@1.10.1 in the root
// `package.json` (AAP §0.3.1) and resolved via `npm install`. Calling
// `morgan(format, options)` returns a plain Express middleware function —
// it does NOT need to be invoked twice or wrapped, so the call result is
// what we export below.
const morgan = require('morgan');

// Internal: the shared winston logger instance exposed by the sibling
// `src/utils/` folder. The relative path `'../utils/logger'` resolves from
// this file's location (`src/middleware/requestLogger.js`) up to `src/` and
// down into `src/utils/logger.js`. The module exports the bare winston
// logger, and crucially attaches a `.stream` property of the shape
// `{ write: (message) => logger.info(message.trim()) }` which is the
// contract `morgan` expects on its `stream` option (AAP §0.5.2). The
// `.info` routing (rather than `.http`) keeps access logs visible under
// the documented default `LOG_LEVEL=info`; see `src/utils/logger.js` for
// the level-priority rationale. Reusing this single logger instance —
// rather than instantiating a new one here — keeps all log output flowing
// through one set of transports.
const logger = require('../utils/logger');

// Build and export the morgan middleware in a single statement. The
// `'combined'` preset selects the Apache combined access-log format, and
// the `{ stream: logger.stream }` option redirects morgan's default stdout
// stream to the winston-backed write stream defined in `src/utils/logger.js`.
// The exported value is the function returned by `morgan(...)` itself, so
// `app.use(requestLogger)` registers it directly without an intermediate
// factory call (AAP §0.7 export-shape rule for middleware modules).
module.exports = morgan('combined', { stream: logger.stream });
