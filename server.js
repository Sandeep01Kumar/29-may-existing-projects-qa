/**
 * server.js — Production HTTP bootstrap / network listener for the Express app.
 *
 * Purpose
 * -------
 * This module is the ONLY socket-binding entry point of the service. It
 * composes the configured Express application (`src/app.js`) with Node's
 * built-in `http` module to produce a real `http.Server` instance, listens
 * on the environment-configured host/port (defaulting to the original
 * `127.0.0.1:3000` bind for backward compatibility), and wires graceful
 * shutdown handlers for `SIGINT` / `SIGTERM` so PM2 (and operators using
 * Ctrl-C during local development) can stop the process cleanly without
 * dropping in-flight requests.
 *
 * Lineage
 * -------
 * Refactor of the pre-Express `server.js` (AAP [server.js:L1-L14]), which was
 * a self-contained 14-line native-`http` server that bound `127.0.0.1:3000`
 * and returned the legacy greeting body for every request via an inline
 * anonymous handler. The inline handler and its response literal HAVE MOVED
 * OUT of this file into `src/routes/greeting.routes.js` (mounted by
 * `src/app.js`).
 * This bootstrap retains only the responsibilities the routing layer cannot
 * own: configuration loading (via `src/config/index.js`), HTTP server
 * construction, port binding, structured startup logging (replacing the
 * legacy `console.log` line at AAP [server.js:L13]), and process-signal
 * handling for graceful shutdown.
 *
 * Architectural contract — separation of app and server (AAP §0.7)
 * ----------------------------------------------------------------
 * The Express application instance is intentionally constructed in
 * `src/app.js` and exported WITHOUT opening any socket of its own
 * (no listener and no server-creation call inside that module). That
 * separation is a hard project rule and
 * it allows `tests/greeting.test.js` to import the bare app
 * (`const app = require('../src/app')`) and drive it through `supertest`
 * without binding a real port — eliminating port-collision risk in CI and
 * keeping unit-level endpoint tests fully isolated from the production
 * bootstrap.  Conversely, this file MUST NOT re-export the app and MUST
 * NOT declare any inline route handlers; the legacy greeting body and the
 * new `Good evening` body live solely in `src/routes/greeting.routes.js`.
 *
 * Default bind preservation (AAP §0.7 backward-compatible binding)
 * ----------------------------------------------------------------
 * The original `server.js` had `127.0.0.1` and `3000` hard-coded at L3-L4.
 * Those constants now come from `src/config/index.js`, whose defaults are
 * the exact same `127.0.0.1` / `3000` values — so running `node server.js`
 * with no environment overrides reproduces the legacy bind byte-for-byte.
 * Operators (and PM2) can override host/port via the `HOST` / `PORT`
 * environment variables documented in `.env.example`.
 *
 * Graceful shutdown (AAP §0.5.2, §0.7 production hardening)
 * ---------------------------------------------------------
 * Both `SIGTERM` (delivered by PM2 when reloading or stopping the process,
 * and by `kill <pid>` in operator scripts) and `SIGINT` (delivered by a
 * developer pressing Ctrl-C in the terminal) are intercepted and routed
 * through the same `shutdown(signal)` helper. The helper logs the received
 * signal via the structured logger and then calls `server.close(...)`,
 * which:
 *   1. Stops accepting NEW incoming connections immediately.
 *   2. Allows ALREADY-IN-FLIGHT requests to finish their response cycle.
 *   3. Invokes its callback once all sockets have drained, at which point
 *      we exit the process with code 0 to signal a clean shutdown.
 * This pattern is what makes PM2's `pm2 reload ecosystem.config.js`
 * zero-downtime: the old worker keeps serving until its `server.close`
 * callback fires, while the new worker takes over new traffic.
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per AAP §0.7 repository
 * convention — matches the pre-Express `server.js` style (`require('http')`
 * at L1) and every other module in the project. No ESM (`import`/`export`)
 * syntax is introduced. Indentation is 2 spaces.
 *
 * Out of scope (deliberately NOT here — AAP §0.6.2)
 * -------------------------------------------------
 *   - Route declarations and response bodies — owned by `src/routes/*`.
 *   - Middleware pipeline construction — owned by `src/app.js`.
 *   - Environment-variable parsing — owned by `src/config/index.js`.
 *   - Logger construction — owned by `src/utils/logger.js`.
 *   - HTTPS/TLS termination, clustering, and authentication — not requested.
 *
 * @module server
 */

'use strict';

// Built-in Node HTTP module. Retained from the pre-Express implementation
// (AAP [server.js:L1]) because it is still the canonical way to wrap a
// request-listener function (the Express app) into a real `http.Server`
// instance that exposes `listen(...)` and `close(...)`. We do NOT call the
// Express app's own `listen` method directly: doing so would hide the
// server handle that the graceful-shutdown handlers below need in order to
// call `server.close(...)`, and it would also tie the app to the
// production socket lifecycle
// (which would break the test-isolation property described in the module
// header).
const http = require('http');

// Internal: the configured Express application instance. `src/app.js`
// exports the BARE app (not `{ app }`), which is itself a callable
// `(req, res) => ...` function. Passing it directly to
// `http.createServer(...)` makes it the request listener for every
// incoming connection. This is the single integration seam between the
// network layer (this file) and the application layer (`src/app.js`).
const app = require('./src/app');

// Internal: environment-driven configuration. `src/config/index.js`
// loads `.env` via `dotenv` and exports a frozen-shape object whose
// `host` and `port` fields default to `127.0.0.1` and `3000` — the same
// values that were hard-coded at AAP [server.js:L3-L4]. We use the
// imported binding's fields below rather than copying them into local
// variables so the config remains the single source of truth.
const config = require('./src/config');

// Internal: the structured winston logger. Replaces the legacy single
// `console.log` line at AAP [server.js:L13]. We use `logger.info(...)` for
// the startup banner and the shutdown-signal acknowledgements; severity
// is intentionally `info` because both events are normal, expected
// lifecycle milestones — not warnings or errors.
const logger = require('./src/utils/logger');

// ----------------------------------------------------------------------------
// HTTP server construction.
//
// `http.createServer(app)` returns an `http.Server` whose request handler is
// the Express application. Because Express apps are themselves callable
// `(req, res, next) => ...` functions, no adapter is needed — the same
// instance that `supertest` drives in tests is the one serving production
// traffic here. Retaining the returned `server` handle is REQUIRED so the
// graceful-shutdown handlers below can call `server.close(...)` to stop
// accepting new connections while draining in-flight requests.
// ----------------------------------------------------------------------------
const server = http.createServer(app);

// ----------------------------------------------------------------------------
// Start listening for incoming connections.
//
// `server.listen(port, host, callback)` binds the configured host/port and
// invokes the callback once the socket is open and ready for traffic. The
// defaults in `src/config/index.js` reproduce the legacy `127.0.0.1:3000`
// bind exactly, so running `node server.js` with no environment overrides
// preserves the original observable behavior — a hard requirement of the
// AAP backward-compatibility rule.
//
// The startup line is emitted through the structured logger (replacing the
// `console.log` at AAP [server.js:L13]) so it shares the transport
// configuration of every other log line in the service — including HTTP
// access logs piped through `morgan -> logger.stream` and error logs from
// `src/middleware/errorHandler.js`. The URL is composed from the same
// config values that drove the bind, so the logged URL always matches the
// effective listener, even when `HOST` / `PORT` are overridden via the env.
// ----------------------------------------------------------------------------
server.listen(config.port, config.host, () => {
  logger.info(`Server running at http://${config.host}:${config.port}/`);
});

// ----------------------------------------------------------------------------
// Graceful shutdown.
//
// Both `SIGTERM` (PM2 reload/stop, container orchestrators, `kill <pid>`)
// and `SIGINT` (developer Ctrl-C in a foreground terminal) are routed
// through the same helper so the shutdown semantics are identical across
// every termination path. The helper:
//
//   1. Logs the signal via the structured logger so PM2 / journalctl /
//      operator dashboards can correlate the lifecycle event.
//   2. Calls `server.close(callback)` — this stops accepting NEW
//      connections immediately but lets ALREADY-IN-FLIGHT requests finish.
//   3. Exits with code 0 once `server.close` reports all sockets drained.
//
// Using a single shared helper (rather than two near-duplicate inline
// arrow functions) keeps the two signal handlers byte-for-byte symmetric
// and makes future additions (e.g., cache flushing, DB connection
// teardown) a one-line change applied to both signals automatically.
// ----------------------------------------------------------------------------
const shutdown = (signal) => {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
