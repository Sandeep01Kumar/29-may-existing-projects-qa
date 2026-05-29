/**
 * src/routes/health.routes.js — Liveness probe router.
 *
 * Purpose
 * -------
 * Exposes a minimal HTTP liveness endpoint that PM2 (and any other external
 * monitoring agent) can poll to determine whether the Node.js process is up
 * and the Express request pipeline is serving traffic. The endpoint is
 * deliberately cheap, dependency-free, and synchronous — it performs no I/O
 * and reports only that the process is alive.
 *
 * Mount point (cross-folder contract)
 * -----------------------------------
 * The aggregator `src/routes/index.js` mounts THIS router under the `/health`
 * path prefix via:
 *
 *   const healthRoutes = require('./health.routes');
 *   router.use('/health', healthRoutes);
 *
 * Because Express PREFIXES the mount path to every route defined inside this
 * module, the handler below is registered at the router-relative path `'/'`,
 * NOT at `'/health'`. Using `'/health'` here would produce the external
 * endpoint `GET /health/health` — that is the well-known "double-prefix"
 * pitfall this module is deliberately written to avoid.
 *
 *   router.get('/',       ...) → external endpoint: GET /health       ✅
 *   router.get('/health', ...) → external endpoint: GET /health/health ❌
 *
 * Response contract
 * -----------------
 *   Method        : GET
 *   External path : /health
 *   Status code   : 200 OK
 *   Content-Type  : application/json; charset=utf-8 (set automatically by
 *                   `res.json(...)`)
 *   Body          : {"status":"ok"}
 *
 * The body is the minimal payload required by PM2 / standard liveness probes.
 * No additional fields are emitted (no uptime, no version, no dependency
 * status) — those are explicitly out of scope per AAP §0.6.2.
 *
 * Lineage
 * -------
 * This route is a NET-NEW addition introduced by the Express-adoption
 * refactor of the legacy `server.js` (AAP §0.5.1 Group 2). The original
 * pre-Express server had no health endpoint; every path returned
 * `Hello, World!\n` from a single inline handler. The liveness probe is added
 * here as part of the "prepare for production deployment with PM2" directive
 * (AAP §0.1.2, §0.7 production hardening).
 *
 * Module system
 * -------------
 * CommonJS only (`require` / `module.exports`) per AAP §0.7 repository
 * convention. No ESM `import` / `export` syntax is used anywhere in this
 * project.
 *
 * @module src/routes/health.routes
 */

'use strict';

// Express provides `Router()` (the sub-application used to scope this module's
// routes) and the `res.json(...)` response helper that serializes the payload
// and automatically sets the `application/json; charset=utf-8` Content-Type.
const express = require('express');

// Create a dedicated router instance for the liveness namespace. The aggregator
// `src/routes/index.js` is responsible for mounting this router under the
// `/health` prefix — see the "Mount point" section in the header above.
const router = express.Router();

/**
 * GET / — Liveness probe.
 *
 * Resolves to the external endpoint `GET /health` once mounted by the
 * aggregator at the `/health` prefix. Returns HTTP 200 with the JSON body
 * `{"status":"ok"}`. The handler is intentionally synchronous and performs
 * no I/O so that the probe stays fast and cannot itself be a source of
 * back-pressure.
 *
 * @param {import('express').Request}  req  Incoming HTTP request (unused).
 * @param {import('express').Response} res  Outgoing HTTP response.
 * @returns {void}
 */
router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
