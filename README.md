# hao-backprop-test

A minimal Node.js HTTP tutorial server enhanced with the [Express.js](https://expressjs.com/) framework. The original single-endpoint `Hello, World!` server has been augmented with routing, middleware, environment-driven configuration, structured logging, and PM2 production-deployment readiness — while preserving its original observable behavior on the loopback interface.

---

## Overview

The service exposes a small set of HTTP endpoints over an Express application. The legacy greeting (`GET /`) returns the exact same byte-for-byte body as the original `server.js` implementation, so any existing client integration continues to work unchanged. A new `GET /good-evening` endpoint and a `GET /health` liveness probe have been added on top of the same Express pipeline.

Key features:

- **Express.js** as the HTTP framework (replacing the native `http` module for request handling).
- **Routing** via dedicated `express.Router` modules under `src/routes/`.
- **Middleware pipeline**: JSON body parsing, HTTP access logging (`morgan`), 404 handling, and centralized error handling.
- **Environment configuration** via `dotenv` (`HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`).
- **Structured logging** via `winston`, with `morgan` access logs piped into the same transport.
- **Graceful shutdown** on `SIGINT` / `SIGTERM`.
- **Production deployment** via PM2 with an `ecosystem.config.js` configuration.

---

## Endpoints

The service exposes the following endpoints. Response bodies below are **byte-for-byte exact** — do not reword, trim, or re-case them.

| Method | Path             | Status | Content-Type        | Response body              |
|--------|------------------|--------|---------------------|----------------------------|
| GET    | `/`              | `200`  | `text/plain`        | `Hello, World!\n`          |
| GET    | `/good-evening`  | `200`  | `text/plain`        | `Good evening`             |
| GET    | `/health`        | `200`  | `application/json`  | `{ "status": "ok" }`       |

Notes:

- The body for `GET /` is the literal text `Hello, World!` followed by a single newline character (`\n`). This is preserved exactly from the original `server.js`.
- The body for `GET /good-evening` is the literal text `Good evening` with no trailing newline.
- The body for `GET /health` is a JSON object intended as a liveness probe for PM2 and external monitoring.

Any unmatched route returns `404 Not Found` from the 404 middleware.

---

## Requirements

- **Node.js**: 22.x (Active LTS) recommended.
- **Engines**: `node >= 18` is enforced via `package.json#engines.node` (the floor required by Express 5 and PM2).
- **npm**: 9+ (ships with Node.js 18+).

---

## Installation

Clone the repository and install dependencies from the project root:

```bash
npm install
```

This installs the pinned runtime dependencies (`express`, `dotenv`, `morgan`, `winston`) and dev dependencies (`jest`, `supertest`, `nodemon`, `pm2`) declared in `package.json`.

---

## Configuration

Configuration is sourced from environment variables, loaded automatically from a `.env` file by [`dotenv`](https://www.npmjs.com/package/dotenv) at process start. A template is provided in [`.env.example`](./.env.example) — copy it to `.env` and adjust values as needed:

```bash
cp .env.example .env
```

### Supported environment variables

| Variable     | Default       | Description                                                                |
|--------------|---------------|----------------------------------------------------------------------------|
| `NODE_ENV`   | `development` | Application environment (`development`, `production`, etc.).               |
| `HOST`       | `127.0.0.1`   | HTTP bind address. Default preserves the original loopback-only behavior.  |
| `PORT`       | `3000`        | HTTP bind port.                                                            |
| `LOG_LEVEL`  | `info`        | `winston` log level (`error`, `warn`, `info`, `http`, `debug`).            |

> **Default bind:** when no environment variables are set, the server listens on **`http://127.0.0.1:3000/`** — identical to the original `server.js` behavior. This is a backward-compatibility guarantee.

---

## Running the server

Three npm scripts are provided for local execution:

| Script         | Command              | Purpose                                            |
|----------------|----------------------|----------------------------------------------------|
| `npm start`    | `node server.js`     | Run the server in the foreground (production-style).|
| `npm run dev`  | `nodemon server.js`  | Run the server with auto-reload for development.   |
| `npm test`     | `jest`               | Run the test suite (Jest + Supertest).             |

Example:

```bash
# Start the server (defaults to http://127.0.0.1:3000/)
npm start

# In another terminal, exercise the endpoints
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/good-evening
curl -i http://127.0.0.1:3000/health
```

---

## Production deployment with PM2

The repository ships an `ecosystem.config.js` for [PM2](https://pm2.keymetrics.io/), with environment-specific blocks for default and `production` profiles. The following npm scripts wrap PM2 lifecycle commands:

| Script                     | Command                                                  | Purpose                                                            |
|----------------------------|----------------------------------------------------------|--------------------------------------------------------------------|
| `npm run pm2:start`        | `pm2 start ecosystem.config.js`                          | Start the app under PM2 using the default environment block.       |
| `npm run pm2:start:prod`   | `pm2 start ecosystem.config.js --env production`         | Start the app under PM2 using the `production` environment block.  |
| `npm run pm2:stop`         | `pm2 stop ecosystem.config.js`                           | Stop the PM2-managed app defined in `ecosystem.config.js`.         |
| `npm run pm2:reload`       | `pm2 reload ecosystem.config.js`                         | Zero-downtime reload of the PM2-managed app.                       |
| `npm run pm2:logs`         | `pm2 logs`                                               | Tail PM2 application and error logs.                               |

PM2 may be installed globally on the host (`npm install -g pm2`) or used via the project-local dev dependency (`npx pm2 ...`). The application implements graceful shutdown on `SIGINT` and `SIGTERM`, allowing PM2 to manage restarts and reloads cleanly.

---

## Project structure

```
.
├── server.js               # Bootstrap: loads config, creates HTTP server around the Express app, listens, handles shutdown.
├── ecosystem.config.js     # PM2 application definition (env blocks, log paths).
├── package.json            # npm manifest: dependencies, scripts, engines.
├── .env.example            # Template for environment variables.
├── src/
│   ├── app.js              # Constructs and exports the configured Express `app` (no listen call — testable).
│   ├── config/
│   │   └── index.js        # Loads `.env` via dotenv and exports typed config (`host`, `port`, `env`, `logLevel`).
│   ├── routes/
│   │   ├── index.js        # Aggregates and mounts feature routers.
│   │   ├── greeting.routes.js  # `GET /` and `GET /good-evening`.
│   │   └── health.routes.js    # `GET /health`.
│   ├── middleware/
│   │   ├── requestLogger.js    # morgan access logs piped into the winston logger.
│   │   ├── notFound.js         # 404 handler for unmatched routes.
│   │   └── errorHandler.js     # Centralized four-argument error handler.
│   └── utils/
│       └── logger.js       # winston logger instance + morgan-compatible write stream.
└── tests/
    └── greeting.test.js    # Supertest assertions for `/`, `/good-evening`, and a 404 path.
```

---

## Documented assumption — route paths

The user prompt requested two endpoints — the existing greeting and a new "Good evening" response — but did not specify the exact route paths. This implementation adopts:

- `GET /` for the preserved greeting (matches the original `server.js`, which responded to every request).
- `GET /good-evening` for the new response.

If a consuming integration requires different paths, only **`src/routes/greeting.routes.js`** and this README need to be adjusted; the rest of the application is unaffected.
