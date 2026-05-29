/**
 * src/app.js — Configured Express application (no socket binding).
 *
 * Purpose
 * -------
 * This module is the heart of the Express adoption for this project. It
 * constructs an `express()` application instance, assembles the full
 * middleware pipeline mandated by the project rule (AAP §0.1.2 — "Express.js
 * framework, routing, middleware, environment config, logging, and prepare
 * for production deployment with PM2"), mounts the feature routers, and
 * exports the configured `app` instance.
 *
 * Crucially, this module DOES NOT open a network socket: it never calls
 * `app.listen(...)` and never invokes `http.createServer(...)`. That
 * responsibility belongs solely to the root `server.js` bootstrap (AAP
 * §0.7 "separation of app and server"). This separation is the architectural
 * keystone that makes the application testable: `tests/greeting.test.js`
 * can `const app = require('../src/app')` and feed it directly to
 * `supertest`'s `request(app)` helper without binding a port — a property
 * verified by the file-level validation checklist in the agent prompt.
 *
 * Lineage
 * -------
 * This module supersedes the inline request handler from the pre-Express
 * `server.js` (`http.createServer((req, res) => { ... })` at L6-L10), which
 * unconditionally returned `Hello, World!\n` for every request, regardless
 * of HTTP method or URL path. With this Express-adoption refactor, the
 * single, anonymous static handler is decomposed into:
 *
 *   1. A `express.json()` body-parsing layer (enables JSON request bodies).
 *   2. A morgan→winston access-logging layer (`src/middleware/requestLogger.js`).
 *   3. A routed handler layer (`src/routes/index.js`), which preserves the
 *      original `Hello, World!\n` response byte-for-byte at `GET /` and
 *      introduces the new `Good evening` response at `GET /good-evening`
 *      (AAP §0.7 backward-compatibility rule), plus a liveness route at
 *      `GET /health` for PM2/monitoring probes.
 *   4. A terminal 404 handler (`src/middleware/notFound.js`) for any path
 *      not claimed by the feature routers.
 *   5. A centralized four-argument error handler
 *      (`src/middleware/errorHandler.js`) that normalizes any thrown or
 *      forwarded errors into a structured JSON response while logging the
 *      full diagnostic context server-side via winston.
 *
 * Middleware registration order (MANDATORY — AAP §0.4.1, §0.5.1, §0.5.2)
 * ----------------------------------------------------------------------
 * Express dispatches middleware in registration order, and the error
 * handler is identified by function arity rather than by position — so the
 * pipeline must be wired in the exact sequence below. Any deviation will
 * either silently break observability (logger registered after the routers
 * would miss access lines for the routed paths) or break error dispatch
 * (the error handler registered before the routers would never receive
 * errors thrown inside route handlers).
 *
 *   1. `express.json()`     — parses `application/json` request bodies and
 *                              attaches the parsed object to `req.body`.
 *                              Built into Express 5; no separate body-parser
 *                              dependency is required.
 *   2. `requestLogger`      — `morgan('combined', { stream })` piped into
 *                              the winston-backed write stream defined in
 *                              `src/utils/logger.js`. Runs BEFORE the
 *                              routers so every request — including 404s —
 *                              is recorded once.
 *   3. `routes`             — the aggregated `express.Router` from
 *                              `src/routes/index.js`, mounted at the
 *                              application root. The external URL surface
 *                              is governed by the sub-mount prefixes
 *                              declared INSIDE `src/routes/index.js` (see
 *                              that module's header for the authoritative
 *                              sub-mount table).
 *   4. `notFound`           — terminal 3-argument middleware that responds
 *                              with HTTP 404 + `{"error":"Not Found"}` for
 *                              any request not matched by the routers
 *                              above. MUST be registered AFTER the routers
 *                              — otherwise every request would short-circuit
 *                              to 404 before reaching a route.
 *   5. `errorHandler`       — terminal 4-argument middleware
 *                              `(err, req, res, next)`. MUST be registered
 *                              LAST so it catches errors propagated from
 *                              any preceding layer (synchronous throws,
 *                              `next(err)` calls, and rejected promises in
 *                              Express 5).
 *
 * Export contract (CRITICAL — locked by cross-folder coordination)
 * ----------------------------------------------------------------
 * The export is the BARE Express application instance — NOT wrapped in
 * `{ app }`, NOT a factory function. Consumers rely on this exact shape:
 *
 *   // Bootstrap (`server.js`) — passes `app` as the http.createServer
 *   // request listener; Express apps are callable `(req, res) => ...`
 *   // functions, so this works without any unwrapping:
 *   const app = require('./src/app');
 *   const server = http.createServer(app);
 *
 *   // Tests (`tests/greeting.test.js`) — supertest accepts either a
 *   // function or a listening server; passing the bare app lets supertest
 *   // bind to an ephemeral port internally for each request, eliminating
 *   // port-collision risk:
 *   const app = require('../src/app');
 *   const request = require('supertest');
 *   await request(app).get('/').expect(200);
 *
 * Exporting anything other than the bare `app` (e.g., `{ app }`,
 * `{ default: app }`, a factory `() => app`) WILL break both consumers and
 * is explicitly forbidden by the agent prompt's CRITICAL contracts section.
 *
 * Out of scope (AAP §0.6.2 — deliberately NOT added here)
 * -------------------------------------------------------
 *   - `app.listen(...)` / `http.createServer(...)` — owned by `server.js`.
 *   - Authentication, authorization, CORS, helmet, rate-limiting, TLS,
 *     sessions, view engines, static file serving — not requested.
 *   - Additional routes beyond what the mounted routers expose.
 *   - Direct `.env` / config loading — encapsulated in `src/config/index.js`
 *     and consumed by `server.js` and `src/utils/logger.js`. Pulling
 *     configuration in here would couple the app to its environment and
 *     defeat the test-isolation goal.
 *   - Inline response bodies — the exact literal `Hello, World!\n` and the
 *     new `Good evening` literal live in `src/routes/greeting.routes.js`;
 *     this file MUST NOT redeclare them.
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per AAP §0.7 repository
 * convention — matches the pre-Express `server.js` style (`require('http')`
 * at L1) and every other module in the project. No ESM (`import` / `export`)
 * syntax is introduced. Indentation is 2 spaces (AAP §0.7).
 *
 * @module src/app
 */

'use strict';

// External: Express HTTP framework. Provides both the application factory
// `express()` and the built-in `express.json()` body-parsing middleware.
// Declared as a runtime dependency at the pinned version express@5.2.1 in
// the root `package.json` (AAP §0.3.1) and resolved by `npm install`.
// Express 5 promotes async error handling (rejected promises automatically
// propagate to the error handler) and ships `express.json()` natively, so
// no separate `body-parser` package is required.
const express = require('express');

// Internal: the aggregated feature router. `./routes` resolves to
// `src/routes/index.js`, which composes `greeting.routes.js` (mounted at
// '/') and `health.routes.js` (mounted at '/health') and exports the bare
// `express.Router()` instance — itself a middleware function, hence
// compatible with `app.use(...)`. The external URL surface (`GET /`,
// `GET /good-evening`, `GET /health`) is owned by that aggregator; this
// file deliberately treats it as an opaque middleware to keep the
// architectural boundary clean.
const routes = require('./routes');

// Internal: HTTP request access-logging middleware. Resolves to
// `src/middleware/requestLogger.js`, which exports the bare middleware
// produced by `morgan('combined', { stream: logger.stream })`. The
// `combined` preset emits Apache-style access lines (remote-addr, user,
// time, request line, status, bytes, referer, user-agent) that flow into
// the winston logger via the shared `logger.stream`. Mounted BEFORE the
// routers so every request — including those that ultimately 404 — is
// recorded exactly once.
const requestLogger = require('./middleware/requestLogger');

// Internal: 404 Not Found handler. Resolves to
// `src/middleware/notFound.js`, which exports the bare 3-argument
// middleware `(req, res, next) => res.status(404).json({error:'Not Found'})`.
// Mounted AFTER the routers so it only runs when no upstream router
// claimed the request. The function is intentionally terminal — it does
// not call `next()` — and therefore short-circuits the pipeline without
// invoking the error handler.
const notFound = require('./middleware/notFound');

// Internal: centralized error handler. Resolves to
// `src/middleware/errorHandler.js`, which exports the bare 4-argument
// middleware `(err, req, res, next)`. Express identifies error handlers by
// FUNCTION ARITY (`fn.length === 4`), so the four formal parameters there
// are load-bearing — preserving the bare export through this re-import is
// what keeps the arity intact when `app.use(errorHandler)` registers it
// below. Mounted LAST so it catches errors from every preceding layer.
const errorHandler = require('./middleware/errorHandler');

// Instantiate the Express application. `express()` returns a callable
// function — `(req, res, next) => ...` — so the resulting `app` can serve
// directly as an `http.createServer(...)` request listener (as `server.js`
// uses it) AND can be invoked by `supertest`'s `request(app)` helper to
// drive endpoint tests without binding a real port. Both consumers depend
// on this dual nature, which is why the export below is the bare instance.
const app = express();

// ----------------------------------------------------------------------------
// Middleware pipeline — registered in MANDATED order (AAP §0.4.1, §0.5.1).
// The agent prompt's CRITICAL contracts section and validation checklist
// require this exact sequence:
//   express.json() -> requestLogger -> routes -> notFound -> errorHandler
// Re-ordering ANY of these steps will break either observability (logger
// after routers misses request paths), routing (404 before routers
// short-circuits everything), or error dispatch (error handler before
// routers never sees route-thrown errors).
// ----------------------------------------------------------------------------

// 1) Body parsing — parses `application/json` request bodies and attaches
// the result to `req.body`. Built into Express 5 (no separate body-parser
// dependency). Registered FIRST so every downstream layer — including the
// access logger — sees the already-parsed body if it needs it. The current
// feature set (text/plain greetings + JSON health probe) does not actually
// consume request bodies, but `express.json()` is wired now per the
// project rule's "middleware" mandate (AAP §0.1.2) and to keep the pipeline
// production-ready for future POST/PUT endpoints without re-wiring.
app.use(express.json());

// 2) HTTP request access logging — morgan('combined') piped into the
// winston-backed write stream defined in `src/utils/logger.js`. Runs after
// body parsing so the parsed `req.body` is available to any future logger
// extensions, but BEFORE the routers so every request (including 404s and
// requests that throw inside a route handler) is recorded exactly once.
// The middleware itself is the bare function returned by the morgan call
// inside `requestLogger.js`, so no additional invocation is needed here —
// passing the imported binding directly is correct.
app.use(requestLogger);

// 3) Feature routers — the aggregated `express.Router` from
// `src/routes/index.js`. Mounted at the application root so the
// EXTERNAL URLs (`GET /`, `GET /good-evening`, `GET /health`) match the
// sub-mount prefixes declared inside the aggregator. The greeting router
// owns the byte-for-byte preservation of the legacy `Hello, World!\n`
// response at `GET /` (AAP §0.7 backward-compatibility) AND the new
// `Good evening` response at `GET /good-evening` requested by the user.
// This file does NOT declare any inline route handlers — the routing
// layer is the single source of truth for the application's URL surface.
app.use(routes);

// 4) 404 Not Found handler — runs only when no preceding router claimed
// the request. MUST come AFTER `app.use(routes)`: registering it earlier
// would short-circuit every request to 404 before any route handler
// could match. The handler is terminal (does not call `next()`), so the
// error handler below is NOT invoked for plain 404s — only for genuine
// errors thrown or forwarded by upstream layers.
app.use(notFound);

// 5) Centralized error handler — terminal four-argument middleware that
// MUST be registered LAST. Express identifies it as an error handler by
// its arity (4 parameters), and it runs whenever an upstream layer
// throws synchronously, calls `next(err)`, or returns a rejected promise
// (Express 5 auto-forwards rejections to the error path). Registering
// any other middleware AFTER this handler would silently demote it: the
// late middleware would only run on the happy path, and the error
// handler would lose the "last in the chain" property that makes the
// error guarantee work.
app.use(errorHandler);

// Bare-instance export — see the "Export contract" section of the module
// header above for the rationale and the locked consumer contracts. Do
// NOT wrap this in `{ app }` or convert it to a factory — both `server.js`
// and `tests/greeting.test.js` depend on this exact shape.
module.exports = app;
