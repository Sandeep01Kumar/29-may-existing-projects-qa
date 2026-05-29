/**
 * ecosystem.config.js — PM2 process / ecosystem configuration.
 *
 * Purpose
 * -------
 * Declares the application definition consumed by PM2 (the production
 * process manager declared as a devDependency in `package.json` and wrapped
 * by the `pm2:*` npm scripts). The file is read by the PM2 CLI when the
 * operator runs any of the following:
 *
 *   npm run pm2:start          → pm2 start ecosystem.config.js
 *   npm run pm2:start:prod     → pm2 start ecosystem.config.js --env production
 *   npm run pm2:stop           → pm2 stop ecosystem.config.js
 *   npm run pm2:reload         → pm2 reload ecosystem.config.js
 *   npm run pm2:logs           → pm2 logs
 *
 * PM2 reads this file at CLI invocation time. The exported object is NOT a
 * code dependency of any application module — it is parsed by `pm2` itself.
 * That is why this file has zero `require(...)` calls and lists only one
 * "internal import" in its schema: the path-string reference to `server.js`,
 * resolved by the PM2 CLI at runtime, not by Node's module loader from
 * within this file.
 *
 * Lineage (AAP §0.4.1, §0.5.1 Group 2, §0.5.2, §0.7)
 * --------------------------------------------------
 * Net-new file introduced by the Express + production-hardening refactor.
 * The legacy `server.js` (AAP [server.js:L1-L14]) had no associated
 * process-manager configuration: it was launched directly with `node
 * server.js`, hard-coded to `127.0.0.1:3000`, and had no formal lifecycle
 * (no graceful shutdown, no restart policy, no log rotation). PM2 now
 * provides that lifecycle while this file keeps the operator surface
 * declarative and reproducible.
 *
 * Module system
 * -------------
 * CommonJS only (`module.exports`) per AAP §0.7 repository convention —
 * matches `server.js`, `src/app.js`, `src/config/index.js`, and every other
 * module in the project. No ESM (`export default`) syntax is used. PM2's
 * configuration loader explicitly expects CommonJS for `.js` ecosystem
 * files, so this convention is also a PM2 compatibility requirement.
 *
 * Default bind preservation (AAP §0.6.2, §0.7 backward-compatible binding)
 * -----------------------------------------------------------------------
 * The `env.HOST` and `env_production.HOST` values are intentionally pinned
 * to `127.0.0.1` (loopback) so that running `pm2 start ecosystem.config.js`
 * with no operator overrides reproduces the EXACT bind behavior of the
 * legacy `server.js` (`127.0.0.1:3000`). Operators who need to expose the
 * service on a non-loopback interface MUST override `HOST` (e.g., to
 * `0.0.0.0` for all interfaces or to a specific NIC address) either by
 * editing this file for permanent deployments or by exporting `HOST` in
 * the shell before invoking `pm2 start`. Likewise, `PORT` defaults to
 * `3000` and can be overridden via env vars or this file.
 *
 * Out of scope (AAP §0.6.2)
 * -------------------------
 *   - Cluster mode / load tuning beyond the optional toggle — `exec_mode`
 *     is intentionally `'fork'` with `instances: 1` as the baseline; the
 *     operator can switch to `'cluster'` mode and raise `instances` later
 *     without code changes.
 *   - HTTPS / TLS termination, reverse-proxy configuration, container or
 *     orchestrator manifests (Docker, Kubernetes) — handled at the
 *     deployment-platform layer, not by PM2.
 *   - Multi-app definitions — the repository ships a single application;
 *     PM2 supports an array of apps, but only one entry is populated here.
 *
 * @module ecosystem.config
 */

'use strict';

module.exports = {
  // PM2 reads the `apps` array to determine which processes to launch and
  // manage. PM2 supports any number of app definitions in this array (one
  // per managed process), but this repository ships a single service so
  // exactly one entry is populated. Adding additional managed processes in
  // the future is a matter of appending another object literal here.
  apps: [
    {
      // Free-form PM2 process label. Used by `pm2 list`, `pm2 logs`,
      // `pm2 stop <name>`, and similar lifecycle commands so operators
      // can target this app by a stable, human-readable identifier
      // rather than by numeric PM2 id. Matches the repository name in
      // `README.md` (`hao-backprop-test`) so PM2 log lines correlate
      // obviously to this repo when operators tail `pm2 logs`.
      name: 'hao-backprop-test',

      // Path to the Node.js entry script PM2 will execute. MUST be
      // `'server.js'` — the refactored Express bootstrap that loads
      // configuration, creates the `http.Server` around the Express
      // `app`, calls `server.listen(...)`, and installs the graceful
      // shutdown handlers for `SIGINT` / `SIGTERM`. The path is
      // resolved by the PM2 CLI relative to this config file's
      // directory (the repository root). This is the SINGLE socket-
      // binding entry point of the service; no alternate entry exists.
      script: 'server.js',

      // Number of process instances PM2 will spawn. Pinned to `1`
      // because clustering / load tuning is explicitly out of scope per
      // AAP §0.6.2. Operators who later need horizontal scaling on a
      // single host can raise this value and switch `exec_mode` to
      // `'cluster'` — no application-code change is required because
      // the Express app and graceful-shutdown handlers in `server.js`
      // are already cluster-safe (each worker binds via `server.listen`
      // and closes via `server.close`).
      instances: 1,

      // Process-launch strategy. `'fork'` runs `script` as a standalone
      // child process — the simplest, most predictable model and the
      // one chosen for this baseline. The alternative `'cluster'` mode
      // would have PM2 spawn `instances` workers sharing the listening
      // socket via Node's built-in cluster module; intentionally not
      // enabled by default (AAP §0.6.2). See the `instances` comment
      // above for the upgrade path.
      exec_mode: 'fork',

      // Disable PM2's file-watcher auto-restart. Auto-restart on file
      // change is a development-time convenience already provided by
      // `nodemon` via the `npm run dev` script (`nodemon server.js`).
      // Enabling `watch: true` under PM2 would (a) duplicate that role
      // and (b) be actively harmful in production, where a deploy
      // process that touches files must NOT trigger an uncontrolled
      // PM2 restart mid-deploy. The correct production restart
      // mechanism is `npm run pm2:reload`, which calls
      // `pm2 reload ecosystem.config.js` for zero-downtime restart.
      watch: false,

      // ----------------------------------------------------------------
      // Default environment block (applied by `pm2 start ecosystem.config.js`).
      //
      // These variables are exported into the launched process's
      // `process.env`, where they are consumed by `src/config/index.js`
      // (which exposes them as `config.host`, `config.port`, `config.env`,
      // and `config.logLevel`). The values MUST mirror the documented
      // defaults in `.env.example` and in `README.md` so behavior is
      // consistent across local `npm start`, local `nodemon`, and
      // PM2-launched processes.
      //
      // Operators who want different per-deployment values should
      // either edit this block in a deployment-specific fork of the
      // file or export the corresponding environment variables in the
      // shell before invoking PM2 (PM2 propagates shell env to the
      // process unless overridden here).
      // ----------------------------------------------------------------
      env: {
        // Application environment label. `'development'` is the
        // baseline value used for local PM2 runs (`npm run pm2:start`).
        // `src/config/index.js` reads this via `config.env` and
        // exposes it to consumers that may branch on environment
        // (e.g., verbose stack traces in error responses).
        NODE_ENV: 'development',

        // HTTP bind address. Pinned to `127.0.0.1` (loopback) to
        // preserve the legacy `server.js` default bind behavior
        // (AAP §0.6.2 / §0.7). Operators may override `HOST` to
        // `0.0.0.0` (all interfaces) or a specific NIC address for
        // external exposure; the default deliberately matches the
        // pre-Express implementation byte-for-byte.
        HOST: '127.0.0.1',

        // HTTP bind port. Pinned to `3000` to preserve the legacy
        // `server.js` default port. Operators may override `PORT` to
        // any valid TCP port number for external exposure. Note that
        // `src/config/index.js` coerces this value to a Number via
        // `Number(process.env.PORT)`; both the numeric `3000` literal
        // here and a string `"3000"` would be accepted, but the
        // numeric form avoids the coercion round-trip.
        PORT: 3000,

        // Winston log level. `'info'` is the documented default
        // (matches `.env.example` and `src/config/index.js`). Raise
        // to `'debug'` for verbose troubleshooting, or lower to
        // `'warn'` / `'error'` to suppress info-level output.
        LOG_LEVEL: 'info'
      },

      // ----------------------------------------------------------------
      // Production environment block (applied with `--env production`).
      //
      // PM2 selects this block when invoked with
      // `pm2 start ecosystem.config.js --env production` (wrapped by
      // the `npm run pm2:start:prod` script). The values shadow the
      // `env` block above for the production deployment profile.
      //
      // The only definitional difference from `env` is the `NODE_ENV`
      // value (`'production'` vs `'development'`); the bind host/port
      // remain `127.0.0.1:3000` to preserve loopback behavior by
      // default (AAP §0.6.2, §0.7). Production operators expecting
      // public exposure MUST set `HOST=0.0.0.0` (or a specific NIC) in
      // this block OR in the launching shell environment.
      // ----------------------------------------------------------------
      env_production: {
        // Production environment label. Distinguishes production
        // launches from development for any consumer that branches on
        // `process.env.NODE_ENV` (e.g., Express's own `env` property,
        // which controls error-response verbosity).
        NODE_ENV: 'production',

        // HTTP bind address. Kept at `127.0.0.1` by default to
        // preserve loopback behavior (AAP §0.6.2 — "the loopback
        // default bind is preserved while HOST/PORT remain
        // environment-configurable"). Operators MUST override this
        // (e.g., `HOST=0.0.0.0`) when external exposure is required.
        HOST: '127.0.0.1',

        // HTTP bind port. Kept at `3000` for parity with the
        // development default; production deployments typically front
        // this with a reverse proxy and may override `PORT` to any
        // unprivileged port.
        PORT: 3000,

        // Production log level. Held at `'info'` so HTTP access logs
        // (emitted at `info` by `src/utils/logger.js` via the morgan
        // stream) continue to flow through the transport — a
        // requirement of the project rule mandating observable
        // logging. Raise to `'debug'` only for incident response.
        LOG_LEVEL: 'info'
      },

      // ----------------------------------------------------------------
      // PM2 log file targets.
      //
      // PM2 redirects the child process's `stderr` and `stdout` to the
      // files below. Paths are relative to PM2's working directory,
      // which for `pm2 start ecosystem.config.js` defaults to the
      // directory containing this config file — i.e., the repository
      // root. The `logs/` directory is created on demand by PM2 and is
      // git-ignored (see `.gitignore`), so log files never get
      // committed.
      //
      // The split into separate `error_file` and `out_file` (rather
      // than a single combined file) preserves the standard Unix
      // stream separation: operators can tail `pm2-error.log` for
      // failures and `pm2-out.log` for normal output, and downstream
      // tooling (logrotate, fluentd, syslog forwarders) can apply
      // stream-specific routing.
      // ----------------------------------------------------------------
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',

      // Timestamp format prepended by PM2 to each log line. The format
      // string is a Moment.js / day.js-compatible pattern. The chosen
      // pattern (`YYYY-MM-DD HH:mm:ss Z`) renders an ISO-8601-like
      // calendar date, a 24-hour wall-clock time, and the numeric UTC
      // offset (e.g., `+0000`), which is unambiguous across host
      // timezones — a property that matters for distributed log
      // aggregation and incident timelines. The trailing `Z`
      // specifier in this pattern means "numeric timezone offset"
      // (e.g., `+0000`), NOT the literal letter Z.
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
