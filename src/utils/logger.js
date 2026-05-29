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
 *   - logger.info(...)   — startup line + graceful-shutdown messages in server.js
 *   - logger.http(...)   — invoked internally by logger.stream.write
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
// the line through the logger's `http` level so HTTP access logs share
// the same transport configuration as application logs while remaining
// distinguishable by level.
logger.stream = {
  write: (message) => logger.http(message.trim())
};

module.exports = logger;
