/**
 * tests/greeting.test.js — Endpoint test suite (Jest + Supertest).
 *
 * Purpose
 * -------
 * This is the project's automated HTTP-level test suite. It is discovered
 * and executed by Jest via `npm test` (the root `package.json` declares
 * `"test": "jest"`) and replaces the original failing placeholder
 * (`echo "Error: no test specified" && exit 1`). The suite verifies the
 * exact response contracts of every endpoint that the Express application
 * currently exposes — and the 404 behavior for everything else — without
 * binding a real network socket.
 *
 * Architectural contract: app, not server (AAP §0.7)
 * --------------------------------------------------
 * The project rule mandates a clean separation between the configured
 * Express application (`src/app.js`) and the bootstrap that opens a socket
 * (`server.js`). This file deliberately imports the BARE app instance —
 * `require('../src/app')` — and passes it to supertest as `request(app)`.
 * Supertest accepts a callable Express app (which is itself a
 * `(req, res) => ...` function) and handles request dispatch internally
 * without listening on a real port, eliminating port-collision risk and
 * making the suite deterministically fast.
 *
 * Concretely, this file MUST NOT:
 *   - `require('../server')` — that file calls `server.listen(...)` on
 *     module load and would consume a real port for the duration of the
 *     test run.
 *   - Call `app.listen(...)` directly — same problem, plus it leaks an
 *     open handle that prevents Jest from exiting cleanly.
 *   - Spawn a child process or use `http.createServer(app)` manually — the
 *     `request(app)` form is the single supported invocation per AAP §0.7
 *     and the agent prompt's CRITICAL contracts.
 *
 * Endpoint contracts under test (MANDATORY — exact bytes)
 * -------------------------------------------------------
 * The response bodies asserted below are part of the public contract of
 * this service and are reproduced byte-for-byte from the route handlers in
 * `src/routes/greeting.routes.js` and `src/routes/health.routes.js`. Any
 * deviation — re-wording, trimming, re-casing, or whitespace alteration —
 * would silently break the agreement with the consuming "backprop"
 * integration. The literals in this suite are therefore deliberately rigid.
 *
 *   ─────────────────────────────────────────────────────────────────────
 *   GET /                — 200 / text/plain / "Hello, World!\n"
 *                          (trailing LF is REQUIRED — preserved verbatim
 *                          from the pre-Express server.js line 9; AAP §0.7
 *                          backward-compatibility rule)
 *   GET /good-evening    — 200 / text/plain / "Good evening"
 *                          (NO trailing newline; length 12 bytes)
 *   GET /health          — 200 / application/json / { "status": "ok" }
 *                          (PM2 liveness probe — AAP §0.7 production
 *                          hardening)
 *   GET /does-not-exist  — 404 (terminal `notFound` middleware)
 *   ─────────────────────────────────────────────────────────────────────
 *
 * Content-Type handling (key insight from sandbox validation)
 * -----------------------------------------------------------
 * Express 5 emits Content-Type headers WITH a charset suffix:
 *   - `text/plain` responses arrive as `text/plain; charset=utf-8`
 *   - `application/json` responses arrive as `application/json; charset=utf-8`
 *
 * Exact-equality assertions against those header values would therefore
 * always fail. This suite uses regex `.toMatch(/text\/plain/)` and
 * `.toMatch(/application\/json/)` partial matches, which (a) tolerate the
 * charset suffix and (b) future-proof against minor framework-level header
 * tweaks. The `; charset=utf-8` portion is purely metadata; it does NOT
 * change the response body bytes, which remain asserted exactly via
 * `res.text` / `res.body`.
 *
 * Body access via supertest / superagent
 * --------------------------------------
 * Supertest layers on top of superagent, which exposes parsed responses
 * via the following properties on the response object yielded by
 * `await request(app).get(path)`:
 *
 *   - `res.text`   — the raw response body as a UTF-8 string. Populated
 *                    for `text/*` responses and used here for byte-exact
 *                    assertions against the greeting literals.
 *   - `res.body`   — the parsed JSON object. Populated for
 *                    `application/json` responses and used here for the
 *                    deep-equality assertion against `{ status: 'ok' }`.
 *   - `res.status` — the HTTP status code as a number (200, 404, …).
 *   - `res.headers`— a plain object of lowercase header names to values
 *                    (so `res.headers['content-type']` is the canonical
 *                    accessor regardless of how the server cased the
 *                    header).
 *
 * Test runner
 * -----------
 * Jest 30.4.2 (devDependency) discovers this file via its default
 * `testMatch`: `**\/?(*.)+(spec|test).[jt]s?(x)`. No jest config file is
 * present — and none is required (AAP §0.6.2 explicitly excludes jest
 * config/setup files). Jest injects `describe`, `it`, and `expect` as
 * globals at test time; this file does NOT `require('jest')` because the
 * runner is invoked at the process level (`npm test` → `jest`), and the
 * `jest` package is not designed to be imported as a value.
 *
 * Style and module system (AAP §0.7)
 * ----------------------------------
 * CommonJS only (`require` / `module.exports`) to match the repository
 * convention established by the original `server.js` (`require('http')`)
 * and every other source module in this project. Indentation is 2 spaces.
 * The `async`/`await` form of supertest calls is used throughout because
 * it produces the clearest control flow and is the pattern validated in
 * the sandbox reference implementation referenced by the agent prompt.
 *
 * Lineage
 * -------
 * Created from scratch as part of the Express-adoption refactor
 * (AAP §0.5.1 Group 3). Neither this file nor the `tests/` directory
 * existed in the source repository. The byte-for-byte `Hello, World!\n`
 * assertion validates that the refactor preserved the response originally
 * emitted by `server.js` line 9; the `Good evening` assertion validates
 * the net-new endpoint requested by the user prompt; the `/health` and
 * 404 assertions validate the supporting infrastructure mandated by the
 * project rule.
 *
 * Out of scope (AAP §0.6.2 — deliberately not tested here)
 * --------------------------------------------------------
 *   - Authentication, authorization, CORS, TLS, rate-limiting, database,
 *     ORM, or session behavior — none of these features exist in the
 *     application yet.
 *   - Endpoints beyond `/`, `/good-evening`, `/health`, and the 404 path —
 *     the application currently exposes no other routes.
 *   - The non-canonical `/health/health` (double-prefix) path — already
 *     documented as a deliberate 404 in `src/routes/index.js`, but not
 *     part of this suite's contract.
 *   - PM2 process management, environment loading, or logger output — those
 *     belong to higher-level integration / smoke tests, not this HTTP
 *     unit suite.
 *
 * @module tests/greeting.test
 */

'use strict';

// Supertest — HTTP-assertion library. `request(app)` accepts the bare
// Express application (a callable `(req, res) => ...` function) and
// drives it directly, dispatching requests through the in-memory middleware
// pipeline without binding a real network socket. This is the single
// supported invocation pattern per AAP §0.7 (app/server separation) and the
// agent prompt's CRITICAL contracts. Declared as a devDependency at the
// pinned version supertest@7.2.2 in the root `package.json` (AAP §0.3.1).
const request = require('supertest');

// The bare Express application instance, imported from `src/app.js` where
// `module.exports = app` exposes the configured app WITHOUT a `listen` call.
// `app` itself is a function (`typeof app === 'function'`) because
// `express()` returns a callable request listener, which is exactly the
// shape supertest expects. CRITICAL: do NOT require '../server' (which
// would open a socket on module load) and do NOT call `app.listen(...)`
// here — both would defeat the test-isolation goal that this file is built
// around.
const app = require('../src/app');

// ----------------------------------------------------------------------------
// Suite — "Greeting endpoints"
// ----------------------------------------------------------------------------
// Each nested `describe` block corresponds to one HTTP endpoint (or class
// of endpoints) exposed by the application, and each contains a single
// `it` block that asserts the COMPLETE response contract: status, Content-
// Type, and body. The suite is intentionally flat — no shared setup,
// teardown, mocks, or fixtures — because the routes under test perform no
// I/O and require no per-test isolation.
// ----------------------------------------------------------------------------
describe('Greeting endpoints', () => {
  describe('GET /', () => {
    it('returns 200 with the exact "Hello, World!\\n" plain-text body', async () => {
      // Dispatch GET / through the Express middleware pipeline via
      // supertest. `await` is required because supertest returns a
      // thenable that resolves to the parsed response object once the
      // server-side handler completes.
      const res = await request(app).get('/');

      // Status assertion — `res.send(...)` defaults to 200 unless the
      // handler explicitly overrides it. The handler in
      // `src/routes/greeting.routes.js` does NOT override, so 200 is the
      // contractual status here.
      expect(res.status).toBe(200);

      // Content-Type assertion — regex partial match tolerates the
      // `; charset=utf-8` suffix that Express 5 appends to text bodies.
      // See the module header above for the rationale.
      expect(res.headers['content-type']).toMatch(/text\/plain/);

      // Body assertion — byte-for-byte equality with the literal
      // emitted by the handler. The trailing `\n` is REQUIRED — it
      // matches the original pre-Express server (`server.js` line 9:
      // `res.end('Hello, World!\n');`) and is the load-bearing detail
      // for backward compatibility with any client that depends on the
      // exact response bytes (AAP §0.7).
      expect(res.text).toBe('Hello, World!\n');
    });
  });

  describe('GET /good-evening', () => {
    it('returns 200 with the exact "Good evening" plain-text body', async () => {
      // Dispatch GET /good-evening — the net-new endpoint introduced by
      // this feature in response to the user prompt's literal request
      // ("add another endpoint that returns the response of 'Good
      // evening'").
      const res = await request(app).get('/good-evening');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);

      // Body assertion — `Good evening` is 12 bytes with NO trailing
      // newline. The omission of `\n` is INTENTIONAL: the user prompt
      // specified the literal `Good evening`, and the handler in
      // `src/routes/greeting.routes.js` emits exactly those 12 bytes via
      // `res.send('Good evening')`. Asserting `'Good evening\n'` would
      // be a contract violation.
      expect(res.text).toBe('Good evening');
    });
  });

  describe('GET /health', () => {
    it('returns 200 with JSON { status: "ok" }', async () => {
      // Dispatch GET /health — the liveness probe added to support PM2
      // and other external monitoring agents (AAP §0.7 production
      // hardening). The handler lives in `src/routes/health.routes.js`
      // and is mounted at the `/health` prefix by
      // `src/routes/index.js`.
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);

      // Content-Type assertion — `res.json(...)` automatically sets
      // `application/json; charset=utf-8`, hence the regex partial match.
      expect(res.headers['content-type']).toMatch(/application\/json/);

      // Body assertion — `res.json({ status: 'ok' })` serializes the
      // object to a JSON string and superagent parses it back into an
      // object for `res.body`. Using `toEqual` performs a deep
      // structural comparison (the appropriate matcher for object
      // equality in Jest).
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('Unmatched routes', () => {
    it('returns 404 for an unknown path', async () => {
      // Dispatch GET against a deliberately-bogus path. Because none of
      // the feature routers (`/`, `/good-evening`, `/health`) claim this
      // URL, the request falls through to the terminal `notFound`
      // middleware registered LAST in the pipeline by `src/app.js`,
      // which responds with status 404 and the body
      // `{ "error": "Not Found" }` (see `src/middleware/notFound.js`).
      const res = await request(app).get('/does-not-exist');

      // We deliberately assert ONLY the status code here. The body
      // shape of 404 responses is an internal implementation detail
      // (the AAP places it out of scope), and asserting it would
      // brittle-couple this test to the JSON payload chosen by the
      // notFound middleware. Status 404 is the contract; everything
      // else is left to the middleware-level tests (which are not in
      // scope for this feature per AAP §0.6.2).
      expect(res.status).toBe(404);
    });
  });
});
