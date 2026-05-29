/**
 * src/routes/greeting.routes.js — Greeting endpoints router.
 *
 * Purpose
 * -------
 * Defines the two public greeting endpoints exposed by this service:
 *
 *   1. `GET /`             → returns the legacy "Hello, World!" greeting,
 *                            preserved byte-for-byte from the pre-Express
 *                            server implementation.
 *   2. `GET /good-evening` → returns the new "Good evening" greeting added
 *                            by this feature.
 *
 * Both endpoints are intentionally trivial — they perform NO I/O, NO
 * validation, and NO business logic. They are stateless, synchronous, and
 * exist solely to emit a fixed plain-text response body. This minimalism is
 * a deliberate scope decision (AAP §0.6.2): the consuming "backprop"
 * integration depends only on the exact bytes returned.
 *
 * Mount point (cross-folder contract)
 * -----------------------------------
 * The aggregator `src/routes/index.js` mounts THIS router under the ROOT
 * path prefix (`/`) via:
 *
 *   const greetingRoutes = require('./greeting.routes');
 *   router.use('/', greetingRoutes);
 *
 * Because the mount prefix is `'/'`, Express does NOT prepend any path
 * segment to the routes declared inside this module — the handler paths
 * defined here ARE the external endpoint paths. Concretely:
 *
 *   router.get('/',             ...) → external endpoint: GET /             ✅
 *   router.get('/good-evening', ...) → external endpoint: GET /good-evening ✅
 *
 * Response contracts (AAP §0.7 — MANDATORY exact response literals)
 * -----------------------------------------------------------------
 * The two response bodies are part of the public contract of this service
 * and MUST be transmitted byte-for-byte as specified. They must NOT be
 * reworded, trimmed, re-cased, or have their whitespace altered.
 *
 *   ─────────────────────────────────────────────────────────────────────
 *   Endpoint            : GET /
 *   Status code         : 200 OK
 *   Content-Type        : text/plain; charset=utf-8 (set by `res.type()`)
 *   Body (exact bytes)  : "Hello, World!\n"
 *   Body length         : 14 bytes (13 chars + 1-byte LF)
 *   Last body byte      : 0x0A (LF — the trailing newline IS REQUIRED)
 *   ─────────────────────────────────────────────────────────────────────
 *   Endpoint            : GET /good-evening
 *   Status code         : 200 OK
 *   Content-Type        : text/plain; charset=utf-8 (set by `res.type()`)
 *   Body (exact bytes)  : "Good evening"
 *   Body length         : 12 bytes
 *   Last body byte      : 0x67 ('g' — NO trailing newline)
 *   ─────────────────────────────────────────────────────────────────────
 *
 * The `Hello, World!\n` literal — including the terminal LF — is byte-for-byte
 * identical to the response emitted by the original `server.js` line 9
 * (`res.end('Hello, World!\n');`). Preserving the newline is what makes this
 * refactor backward-compatible (AAP §0.7).
 *
 * Why `res.type('text/plain').send(...)`
 * --------------------------------------
 * Express 5 will infer `text/html; charset=utf-8` for string bodies if no
 * Content-Type is set, which would silently break the contract — the
 * pre-Express server explicitly set `Content-Type: text/plain`
 * (`server.js` line 8). Calling `res.type('text/plain')` ahead of
 * `res.send(...)` forces the Content-Type to `text/plain; charset=utf-8`,
 * preserving the original behavior. The `; charset=utf-8` suffix is standard
 * Express behavior and does NOT alter the response body bytes — it merely
 * advertises the encoding of those bytes to the client.
 *
 * Note: `res.send(...)` defaults the status code to 200, so an explicit
 * `res.status(200)` (or `res.statusCode = 200`) call is unnecessary. We omit
 * it for brevity.
 *
 * Documented assumption (AAP §0.7)
 * --------------------------------
 * The user prompt did NOT specify exact route paths for the new endpoint.
 * The implementation adopts `GET /good-evening` (kebab-case, root-level)
 * as the canonical path. If the consuming integration requires a different
 * path (e.g., `/api/good-evening`, `/goodEvening`), ONLY this file and the
 * `README.md` documentation need adjustment — no other module references
 * the path literal.
 *
 * Lineage
 * -------
 * The `GET /` handler is a refactor of the inline static request handler
 * in the pre-Express `server.js` (lines L6-L10). The `GET /good-evening`
 * handler is a NET-NEW addition introduced by this feature. This module
 * did not exist in the source repository — it is created from scratch as
 * part of the Express-adoption refactor (AAP §0.5.1 Group 1).
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per AAP §0.7 repository
 * convention. No ESM `import` / `export` syntax is used anywhere in this
 * project. Indentation is 2 spaces (AAP §0.7).
 *
 * @module src/routes/greeting.routes
 */

'use strict';

// Express provides `Router()` — the sub-application primitive used to scope
// this module's routes — and the `res.type(...)` / `res.send(...)` response
// helpers that drive the Content-Type negotiation and body transmission.
const express = require('express');

// Create a dedicated router instance for the greeting namespace. The
// aggregator `src/routes/index.js` is responsible for mounting this router
// under the root `/` prefix — see the "Mount point" section in the header
// above.
const router = express.Router();

/**
 * GET / — Legacy "Hello, World!" greeting (preserved from the pre-Express
 * server).
 *
 * Resolves to the external endpoint `GET /` once mounted by the aggregator
 * at the root `/` prefix. Returns HTTP 200 with the plain-text body
 * `Hello, World!\n` — INCLUDING the trailing newline — to maintain
 * byte-for-byte compatibility with the original `server.js` handler
 * (`res.end('Hello, World!\n');` at line 9). The handler is intentionally
 * synchronous and performs no I/O.
 *
 * @param {import('express').Request}  req  Incoming HTTP request (unused —
 *                                          the response is static).
 * @param {import('express').Response} res  Outgoing HTTP response.
 * @returns {void}
 */
router.get('/', (req, res) => {
  res.type('text/plain').send('Hello, World!\n');
});

/**
 * GET /good-evening — New "Good evening" greeting.
 *
 * Resolves to the external endpoint `GET /good-evening` once mounted by
 * the aggregator at the root `/` prefix. Returns HTTP 200 with the
 * plain-text body `Good evening` — WITHOUT a trailing newline — as
 * specified by the user prompt and AAP §0.7. The handler is intentionally
 * synchronous and performs no I/O.
 *
 * @param {import('express').Request}  req  Incoming HTTP request (unused —
 *                                          the response is static).
 * @param {import('express').Response} res  Outgoing HTTP response.
 * @returns {void}
 */
router.get('/good-evening', (req, res) => {
  res.type('text/plain').send('Good evening');
});

module.exports = router;
