/**
 * src/utils/logger.js — Structured application logger (winston) + morgan-compatible stream.
 *
 * Purpose
 * -------
 * Single source of truth for application logging. Replaces the original
 * dependency-free `console.log` startup line of the legacy server
 * (`server.js` L13) with a real `winston` logger and exposes a
 * `morgan`-compatible write stream so HTTP access logs flow through the
 * same transport configuration as application logs.
 *
 * Lineage
 * -------
 * The lone `console.log(`Server running at http://${hostname}:${port}/`)`
 * call at L13 of the pre-Express `server.js` is the observability seam
 * this module supersedes. There were no other logging sites in the legacy
 * source, so every other call site (HTTP access logs via morgan, error
 * logs from the error-handling middleware, graceful-shutdown logs in the
 * bootstrap) is net-new and routed through the instance exported here.
 *
 * Configuration
 * -------------
 * The logger's `level` is taken from `config.logLevel` (sourced from
 * `src/config/index.js`), which in turn honors the `LOG_LEVEL`
 * environment variable and falls back to `'info'`. This indirection keeps
 * the level configurable per-environment (development, production, etc.)
 * without code changes — set `LOG_LEVEL=debug` in `.env` or PM2's env
 * blocks to raise verbosity.
 *
 * Cross-folder consumer contract (locked — DO NOT CHANGE)
 * ------------------------------------------------------
 * The exported value is the bare winston logger INSTANCE (not a wrapper
 * object). Consumers import it directly and call methods on the import:
 *
 *   const logger = require('./src/utils/logger');   // bootstrap (server.js)
 *   const logger = require('../utils/logger');      // siblings/children
 *
 * Required members exposed by the export:
 *   - logger.info(...)   — startup line + graceful-shutdown messages in
 *                          server.js AND the level used internally by
 *                          logger.stream.write for HTTP access lines
 *                          (chosen so morgan output is visible under the
 *                          documented default LOG_LEVEL=info — see the
 *                          inline rationale at logger.stream below)
 *   - logger.error(...)  — used by src/middleware/errorHandler.js
 *   - logger.warn(...)   — standard winston level (general consumer use)
 *   - logger.debug(...)  — standard winston level (general consumer use)
 *   - logger.log(...)    — standard winston signature (level, message, [meta])
 *   - logger.stream      — object with a `write(message)` method
 *   - logger.stream.write(...) — consumed by src/middleware/requestLogger.js
 *     via `morgan('combined', { stream: logger.stream })`
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per AAP §0.7 repository
 * convention — matches the existing `server.js` style. No ESM syntax.
 */

const winston = require('winston');
const config = require('../config');

// Construct the application-wide winston logger at the configured level
// with a Console transport. The Console transport is the minimum required
// surface; richer transports (e.g., File) can be added here without
// changing the consumer contract above. Keeping the formatter at winston's
// built-in default keeps output predictable in the PM2 log files and in
// local development.
const logger = winston.createLogger({
  level: config.logLevel,
  transports: [
    new winston.transports.Console()
  ]
});

// Morgan calls `stream.write(message)` with a trailing newline for each
// HTTP access line. We trim that newline (winston adds its own) and route
// the line through the logger's `info` level so HTTP access logs share
// the same transport configuration as application logs.
//
// Why `info` and not `http`?
// --------------------------
// In winston's default npm levels, the level-priority ordering is
//
//   error (0) < warn (1) < info (2) < http (3) < verbose (4) < debug (5) < silly (6)
//
// and a logger configured at level X emits records whose priority is <= X.
// The documented default `LOG_LEVEL=info` (priority 2) therefore SUPPRESSES
// any record emitted at the `http` level (priority 3) — every `logger.http`
// call gets filtered before reaching the Console transport. Routing morgan's
// stream through `logger.http(...)` under the default configuration would
// therefore silently disable HTTP access logging, contradicting the project
// rule (AAP §0.1.2) that mandates observable logging.
//
// Emitting at `info` instead guarantees that access logs flow through the
// transport whenever the user-configured `LOG_LEVEL` is at or above `info`
// — which is the documented default and every reasonable production
// setting. Operators who explicitly suppress info-level output
// (`LOG_LEVEL=warn` or `LOG_LEVEL=error`) deliberately opt out of access
// logging together with application info logs, which is the intended
// semantics. The semantic distinction between "HTTP access" and
// "application info" is preserved by the morgan-formatted message content
// itself (Apache "combined" lines are unambiguously access records), so no
// information is lost by sharing the `info` severity bucket.
logger.stream = {
  write: (message) => logger.info(message.trim())
};

module.exports = logger;
