/**
 * src/routes/index.js — Feature router aggregator.
 *
 * Purpose
 * -------
 * This module is the single entry point for the application's HTTP routing
 * layer. It composes the individual feature routers
 * (`src/routes/greeting.routes.js` and `src/routes/health.routes.js`) into
 * one `express.Router` instance and exports that instance so the upstream
 * application bootstrap (`src/app.js`) can mount the whole routing tree with
 * a single `app.use(...)` call.
 *
 * Architectural role (AAP §0.1.2, §0.5)
 * -------------------------------------
 * The project rule "QA-20-may-custom-rules" mandates a dedicated routing
 * layer ("Enhance this basic HTTP server with Express.js framework, add
 * routing, middleware ..."). This file IS that routing layer: it replaces
 * the single inline request handler from the pre-Express `server.js`
 * [server.js:L6-L10] with a structured, modular composition of feature
 * routers.
 *
 * Cross-folder contract with `src/app.js` (CRITICAL — do not deviate)
 * -------------------------------------------------------------------
 *   1. `src/app.js` imports this module via:
 *
 *        const routes = require('./routes');
 *        app.use(routes);
 *
 *      Because `app.use(...)` expects a middleware function (an
 *      `express.Router()` IS a middleware function), this module MUST
 *      export the BARE router instance:
 *
 *        module.exports = router;          // ✅ correct
 *        module.exports = { router };      // ❌ would break app.use
 *
 *   2. `src/app.js` mounts this aggregator at the application ROOT
 *      (`/`) with NO path prefix. Consequently, the EXTERNAL URL paths
 *      served by the application are determined ENTIRELY by the sub-mount
 *      prefixes declared in THIS file. The upstream bootstrap intentionally
 *      delegates that responsibility here.
 *
 * Sub-mount table (the source of truth for external URLs)
 * -------------------------------------------------------
 *   ┌────────────────────────┬────────────────────┬──────────────────────────┐
 *   │ External URL           │ Sub-mount prefix   │ Source router            │
 *   ├────────────────────────┼────────────────────┼──────────────────────────┤
 *   │ GET /                  │ '/'                │ greeting.routes.js (`/`) │
 *   │ GET /good-evening      │ '/'                │ greeting.routes.js       │
 *   │                        │                    │ (`/good-evening`)        │
 *   │ GET /health            │ '/health'          │ health.routes.js (`/`)   │
 *   └────────────────────────┴────────────────────┴──────────────────────────┘
 *
 * The greeting router is mounted at `'/'` so that its internal `'/'` and
 * `'/good-evening'` routes resolve to the external `GET /` and
 * `GET /good-evening` endpoints respectively — preserving the exact bytes
 * (`Hello, World!\n`) historically returned by the pre-Express server while
 * adding the new `Good evening` endpoint (AAP §0.7).
 *
 * The health router is mounted at `'/health'` so that its internal `'/'`
 * route resolves to the external `GET /health` endpoint. The health
 * sub-router intentionally declares its handler at `'/'` (NOT `'/health'`)
 * to avoid the well-known "double-prefix" pitfall — i.e., this aggregator
 * mounting at `'/health'` combined with a sub-router declaring `'/health'`
 * would yield `GET /health/health`, which is incorrect. With the current
 * arrangement, `GET /health/health` correctly returns 404.
 *
 * Out-of-scope items handled elsewhere (AAP §0.6.2)
 * -------------------------------------------------
 *   - 404 handling for unmatched routes lives in `src/middleware/notFound.js`
 *     and is wired AFTER this router by `src/app.js`.
 *   - Centralized error handling lives in `src/middleware/errorHandler.js`
 *     and is wired as the LAST middleware by `src/app.js`.
 *   - HTTP request access logging (morgan → winston) lives in
 *     `src/middleware/requestLogger.js` and is wired BEFORE this router by
 *     `src/app.js`.
 *
 * This aggregator is therefore deliberately minimal: it ONLY composes the
 * feature routers — no inline route handlers, no response bodies, no
 * business logic, no validation, no authentication, and no error handling
 * are present in this file.
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per AAP §0.7 repository
 * convention — the original `server.js` uses `require`. No ESM
 * (`import` / `export`) syntax is introduced anywhere in this project.
 * Indentation is 2 spaces (AAP §0.7).
 *
 * Lineage
 * -------
 * This module did NOT exist in the source repository. It is created from
 * scratch as part of the Express-adoption refactor (AAP §0.5.1 Group 1)
 * that decomposes the pre-Express single-handler `server.js`
 * [server.js:L6-L10] into a modular, testable routing layer.
 *
 * @module src/routes/index
 */

'use strict';

// Express provides the `Router()` factory used to build the aggregator's
// composite middleware function.
const express = require('express');

// Feature routers — each module exports its OWN bare `express.Router`
// instance (`module.exports = router;`). The sub-mount prefixes applied by
// this aggregator are documented in the "Sub-mount table" section of the
// module header above and are the SOURCE OF TRUTH for the application's
// external URL surface.
const greetingRoutes = require('./greeting.routes');
const healthRoutes = require('./health.routes');

// The aggregator router itself — `app.use(...)`-compatible because
// `express.Router()` returns a middleware function.
const router = express.Router();

// Mount the greeting sub-router at the ROOT prefix `'/'`. The greeting
// sub-router declares `router.get('/', ...)` and `router.get('/good-evening', ...)`,
// which therefore resolve to the EXTERNAL endpoints `GET /` and
// `GET /good-evening` respectively (AAP §0.7 — exact response literals are
// owned by `greeting.routes.js`).
router.use('/', greetingRoutes);

// Mount the health sub-router at the `'/health'` prefix. The health
// sub-router declares its single handler at `router.get('/', ...)`, which
// therefore resolves to the EXTERNAL endpoint `GET /health`. Mounting at
// `'/health'` (instead of `'/'`) is the deliberate decision that makes the
// liveness probe URL `/health` and prevents the double-prefix pitfall
// (`/health/health` — which would be a 404 with this layout, as expected).
router.use('/health', healthRoutes);

// Export the BARE router instance. The upstream `src/app.js` does
// `app.use(require('./routes'))`, so anything other than a bare
// router/middleware function here would break the application bootstrap.
module.exports = router;
