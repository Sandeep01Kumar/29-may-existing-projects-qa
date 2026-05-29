/**
 * src/config/index.js — Environment configuration module.
 *
 * Purpose
 * -------
 * Centralizes environment-driven configuration for the Express service. Loads
 * variables from the local `.env` file (via `dotenv`) into `process.env`, then
 * exposes a frozen-shape config object with safe defaults that preserve the
 * original `127.0.0.1:3000` bind behavior of the legacy `server.js`
 * implementation when no environment variables are set.
 *
 * Lineage
 * -------
 * The defaults `host: '127.0.0.1'` and `port: 3000` originate from the
 * pre-Express `server.js` constants (L3-L4), which are preserved verbatim per
 * the AAP §0.7 "backward-compatible binding" rule. `env` and `logLevel` are
 * net-new additions introduced by the Express-adoption refactor.
 *
 * Recognized environment variables (and ONLY these four)
 * ------------------------------------------------------
 *   HOST       — HTTP server bind address (default: '127.0.0.1')
 *   PORT       — HTTP server port number  (default: 3000; coerced to Number)
 *   NODE_ENV   — Application environment  (default: 'development')
 *   LOG_LEVEL  — Winston log level        (default: 'info')
 *
 * Consumers (cross-folder contract; field names are LOCKED)
 * ---------------------------------------------------------
 *   - `server.js` reads `config.host` and `config.port` for `server.listen(...)`.
 *   - `src/utils/logger.js` reads `config.logLevel` for the winston logger.
 *   - `.env.example` (tracked) and `ecosystem.config.js` env blocks mirror the
 *     same variable names and default values.
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per AAP §0.7 repository
 * convention; no ESM `import` / `export` syntax is used anywhere.
 */

// Load `.env` (if present) into `process.env` BEFORE any process.env read so
// that the fallbacks below correctly observe `.env`-provided values. The
// `.env` file itself is git-ignored; `.env.example` documents the contract.
//
// `quiet: true` suppresses dotenv v17's unstructured runtime banner (e.g.
// `◇ injected env (N) from .env // tip: ...`) that would otherwise be
// emitted directly to stdout via `console.log`, bypassing the project's
// winston/morgan structured-logging surface. This preserves the AAP §0.7
// R7 "structured logging" guarantee — winston remains the sole observable
// surface for application output, including this module's startup phase.
// The option only gates the runtime banner; env-population semantics,
// `process.env` side effects, return value shape, and error handling are
// all unchanged. Reference: dotenv 17.x `{ quiet: true }` option.
require('dotenv').config({ quiet: true });

module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info'
};
