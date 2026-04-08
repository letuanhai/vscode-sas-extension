# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
npm install          # install all deps (root + client + server via postinstall)
npm run compile      # esbuild production build (client + server, node targets)
npm run watch        # esbuild watch mode with sourcemaps for dev
npm run lint         # ESLint on all TS/TSX files
npm run format       # Prettier write
npm run format:check # Prettier check (CI)
npm run test         # compile + typecheck + run all tests (server + harness + integration)
npm run test-client  # @vscode/test-cli integration tests (downloads VS Code, runs in extension host)
npm run test-harness # Mocha direct-import tests (no VS Code, fast)
npm run test-server  # Mocha + ts-node for server only
npx @vscode/vsce package  # package extension as .vsix (runs lint + compile first)
```

Type-check only (faster than full test):

```bash
npx tsc -p client/tsconfig.json --noEmit
npx tsc -p server/tsconfig.json --noEmit
```

For debugging: open in VS Code and press **F5** ("Launch Client" configuration).

## Code Quality

**After making code changes, always run linting:**

```bash
npm run lint
```

Linting catches errors, enforces style consistency, and must pass before any commit. Run it immediately after editing files — do not wait until the end of a task.

## Testing (for AI agents)

There are two testing approaches. **Choose based on what you need:**

### 1. Direct Test Harness (`npm run test-harness`) — PREFER THIS

**When to use:** Testing code logic, API calls, utilities, stores, data transformations — anything that does NOT require the `vscode` API namespace.

- Files go in `client/test/harness/`
- Runs via Mocha + ts-node directly (no VS Code download, no GUI)
- Uses the same chai/sinon stack as existing tests
- **Fast** — completes in seconds, ideal for agent iteration loops
- Can mock axios to test HTTP API interactions (e.g., StudioWeb adapters)

```bash
# Run all harness tests
npm run test-harness

# Run a single file
npx cross-env TS_NODE_PROJECT=./client/tsconfig.json mocha -r ts-node/register client/test/harness/mytest.test.ts
```

**What to test here:** `state.ts`, `SASCodeDocument`, stores (`useRunStore`, `useLogStore`), `stripHtml`, profile validation, data transformations, adapter logic (with mocked axios).

### 2. VS Code Integration Tests (`npm run test-client`) — WHEN YOU NEED VSCODE API

**When to use:** Testing functionality that requires the VS Code extension host — commands, UI interactions, language server integration, webview panels, tree views.

- Configured in `.vscode-test.mjs` using `@vscode/test-cli`
- Tests go in `client/test/` (compiled to `client/out/test/`)
- Requires `npm run pretest` first (compile + typecheck)
- Downloads VS Code automatically, launches extension host, runs Mocha inside it
- Tests have full access to the `vscode` API

```bash
# Run all integration tests (requires pretest first)
npm run pretest && npm run test-client

# Run only a specific label
npm run test-client:label integration
```

**What to test here:** Extension activation, command registration, LSP features (completion, hover, diagnostics), notebook serialization, content/library tree views, QuickPick UI interactions.

#### Creating a new integration test

1. **Place the test file** under `client/test/` following the existing directory structure (e.g., `client/test/components/ContentNavigator/QuickFileBrowser.test.ts`). Mirror the source tree.
2. **Import from `"vscode"` directly** — the extension host provides the real API. Use `chai` for assertions and `sinon` for stubs/spies (same stack as harness tests).
3. **Stub VS Code UI** when needed — e.g., stub `window.createQuickPick` to capture the QuickPick instance, stub `commands.executeCommand` to intercept `setContext` calls. Forward non-stubbed calls to the original implementation.
4. **Mock the data layer, not the UI layer** — create stub adapters implementing `ContentAdapter` (or similar interfaces) that return predetermined data. Pass them into real model classes. This tests the full integration from model → UI without needing a live server.
5. **Use polling helpers for async UI** — QuickPick items load asynchronously. Use a `waitForNotBusy()` polling helper (check `qp.busy` every ~50ms with a timeout) rather than fixed `sleep()` calls.
6. **Clean up in `afterEach`** — always hide/dispose QuickPicks and restore sinon sandboxes to avoid leaking state between tests.
7. **Assert visible UI state, not internal state** — integration tests must assert what the user actually sees: `qp.title`, `qp.items[].label`, `qp.items[].description`, item order. Do NOT write integration tests that only call an exported helper function directly — those belong in `test-harness` instead. Pure helpers that don't need the vscode API (even if they accept `vscode` types as parameters) should be tested in harness using plain object fakes.

#### Building and running

```bash
# Compile TypeScript (required before running)
npx tsc -p ./client/tsconfig.json

# Run a single test file
xvfb-run npx vscode-test --run client/out/test/components/ContentNavigator/QuickFileBrowser.test.js

# Run all integration tests
npm run pretest && xvfb-run npm run test-client

# Type-check only (no compile output, fast feedback)
npx tsc -p ./client/tsconfig.json --noEmit
```

**Headless environments:** VS Code requires a display server. **Always use `xvfb-run`** to run `vscode-test` on Linux headless machines (install with `sudo apt-get install -y xvfb`). GPU errors in the output are harmless. Example:

```bash
xvfb-run npx vscode-test                   # all labels
xvfb-run npx vscode-test --label integration
xvfb-run npx vscode-test --label studioweb-live-ui
```

#### Reference example

See `client/test/components/ContentNavigator/QuickFileBrowser.test.ts` for a complete example showing: stub adapter creation, QuickPick instance capture via `window.createQuickPick` spy, async item loading, `setContext` verification, and proper cleanup.

### 3. StudioWeb Live UI Tests (`studioweb-live-ui`) — WHEN YOU NEED LIVE SERVER + VSCODE UI

**When to use:** Testing VS Code UI components (tree views, QuickPick, commands, sidebar panels) against the real dev SAS Studio server.

- Files go in `client/test/live-ui/`
- Runs via `@vscode/test-cli` with the `studioweb-live-ui` label
- Requires `SAS_UI_LIVE=1` env var (tests skip otherwise)
- Optionally set `SAS_UI_LIVE_ENDPOINT` (defaults to `http://192.168.0.141/SASStudio/38`)
- Uses shared helpers in `client/test/live-ui/helpers.ts` for profile bootstrap and cleanup
- **One session per suite** — the dev server has limited memory

```bash
# Compile first, then run live UI tests
npm run pretest
SAS_UI_LIVE=1 xvfb-run npx vscode-test --label studioweb-live-ui
```

**What to test here:** Tree view visibility, QuickPick behavior with live data, command registration, `setContext` wiring, sidebar panel focus/reveal.

**Key helpers in `helpers.ts`:**

- `describeIfLive(title, fn)` — conditional `describe` gated on `SAS_UI_LIVE=1`
- `bootstrapStudioWebProfile()` — writes a StudioWeb profile to VS Code settings
- `cleanupProfile()` — closes session and resets settings
- `recordSetContext()` — intercepts `setContext` calls for assertion
- `waitFor(predicate, timeout)` — polling helper for async UI

### Decision guide for agents

| Need to test…                       | Use                 |
| ----------------------------------- | ------------------- |
| Pure function / utility             | `test-harness`      |
| Store actions (zustand)             | `test-harness`      |
| HTTP API logic (with mocked axios)  | `test-harness`      |
| Data transformation / parsing       | `test-harness`      |
| VS Code command execution           | `test-client`       |
| LSP features (completion, hover)    | `test-client`       |
| Extension activation / registration | `test-client`       |
| Anything importing from `"vscode"`  | `test-client`       |
| Tree views with live server data    | `studioweb-live-ui` |
| QuickPick with live server data     | `studioweb-live-ui` |
| setContext wiring with live profile | `studioweb-live-ui` |

## Architecture

The repo is a VS Code extension split into two independent TypeScript packages:

- **`client/`** — the extension itself (UI, commands, connection logic, tree views). Entry points: `client/src/node/extension.ts` (Electron) and `client/src/browser/extension.ts` (web).
- **`server/`** — a Language Server Protocol (LSP) server providing SAS/Python syntax features (completion, hover, diagnostics). Compiled separately and launched as a child process.

Build uses **esbuild** (`tools/build.mjs`) for node targets and **webpack** (`webpack.config.js`) for browser/webworker targets.

### Connection system

All connection types share a common abstract base (`client/src/connection/session.ts`):

```
Session (abstract)
  ├── establishConnection(): Promise<void>
  ├── _run(code): Promise<RunResult>        // RunResult = { html5?, title? }
  ├── _close(): Promise<void>
  ├── cancel?(): Promise<void>
  └── sessionId?(): string | undefined
```

Connection types live in `client/src/connection/{rest,itc,ssh,studioweb}/`. Each exports a `getSession(config)` factory returning the singleton session. `client/src/connection/index.ts` is the single dispatch point — add a `case ConnectionType.X` there when adding a new type.

Profile types and the `ConnectionType` enum are in `client/src/components/profile.ts`. Adding a connection type requires changes in: `profile.ts` (enum + interface + `prompt()` + `validateProfile()` + `remoteTarget()`), `connection/index.ts`, and both adapter factories.

### Adapter pattern (file & library navigation)

Tree-view panels use adapters rather than calling session code directly:

- **`LibraryAdapterFactory`** → `LibraryAdapter` (browse libraries/tables, query data)
- **`ContentAdapterFactory`** → `ContentAdapter` (browse/read/write server files)

Factory dispatch uses `connectionType` (library) or `"${connectionType}.${sourceType}"` (content). Implementations live alongside their session code: e.g. `connection/studioweb/StudioWebLibraryAdapter.ts`.

### Code submission pipeline

`run.ts` → `SASCodeDocument.getWrappedCode()` → `session.run()`:

- `SASCodeDocument` (`components/utils/SASCodeDocument.ts`) wraps user code with ODS HTML5 statements, autoexec, `%let _SASPROGRAMFILE`, etc. The `outputHtml` flag controls ODS wrapping.
- **StudioWeb note**: `StudioWebSession._run()` strips the ODS wrapper before submitting because SAS Studio handles output rendering natively. Results are fetched via the `results` link in the `SubmitComplete` poll message.

### SAS Studio Web connection (current feature branch)

`client/src/connection/studioweb/` implements the `studioweb` connection type:

- `state.ts` — holds runtime credentials (endpoint, session ID, cookie) in memory; never persisted. Provides a shared axios instance with `baseURL = {endpoint}/sasexec`.
- `index.ts` — `StudioWebSession`: prompts for session ID + cookie on first `establishConnection()`; submits code via `POST /sessions/{id}/asyncSubmissions`; polls `/sessions/{id}/messages/longpoll` until `SubmitComplete` or empty response; cancels via `DELETE /sessions/{id}/submissions?id={submissionId}`.
- `StudioWebLibraryAdapter.ts` — uses `/libdata/{id}/libraries` and `/sessions/{id}/sql` endpoints.
- `StudioWebServerAdapter.ts` — uses `/sessions/{id}/workspace/~~ds~~{path}` for file operations.

The `SAS.studioweb.newSession` command (registered in `node/extension.ts`) closes the current session and re-prompts for credentials.

### View visibility

`updateViewSettings()` in `node/extension.ts` controls sidebar panel visibility via `setContext`:

| Context key            | Enabled for                        |
| ---------------------- | ---------------------------------- |
| `SAS.canSignIn`        | All types except SSH and StudioWeb |
| `SAS.librariesEnabled` | All types except SSH               |
| `SAS.serverEnabled`    | All types except SSH               |
| `SAS.contentEnabled`   | REST (Viya) and StudioWeb          |

## SAS Studio Web Testing Considerations

**⚠️ Important:** The dev SAS Studio server at `192.168.0.141` has limited memory. When writing tests:

- **Reuse sessions when possible** - Don't create a new session for every test if tests can share one
- **Clean up sessions** - Use `DELETE /sessions/{id}` in `after`/`afterEach` hooks to explicitly delete sessions and free up server resources
- **Avoid heavy parallelism** - Creating many sessions concurrently under active load may trigger HTTP 503; reuse sessions rather than creating one per test

**Session creation endpoint:**

```bash
POST http://192.168.0.141/SASStudio/38/sasexec/sessions
# Dev instance: no authorization cookie required — just POST with empty body
# Production: must include auth token cookie from SAS Studio login flow in ALL requests
# Response sets: Set-Cookie: JSESSIONID=<token>
# Returns: { id, baseURL, version, sasSysUserId, userDirectory, ... }
```

**Session status check:**

```bash
GET http://192.168.0.141/SASStudio/38/sasexec/sessions/{sessionId}/ping
# Returns: { lastAccessedTime, running, queued, lastAccessedSpanInMilliseconds }
# HTTP 404 = session expired/invalid
```

**Session cleanup/delete:**

```bash
DELETE http://192.168.0.141/SASStudio/38/sasexec/sessions/{sessionId}
# Returns: HTTP 200 on success
# Use this in after/afterEach hooks to clean up test sessions
```

## SAS Studio Web API Reference

The following documentation files describe the internal SAS Studio Web REST API used by the `studioweb` connection type:

| File                              | Description                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SASStudio-API-Documentation.md`  | Complete API reference: code execution, file operations, library navigation, SQL queries, and VS Code extension integration guide |
| `SASStudio-FileOperations-API.md` | Detailed file/folder operations: path encoding (`~ps~`, `~dot~`), tree loading, CRUD operations, BIP tree, FTP, and CSRF handling |
| `SASStudio-API.ipynb`             | Interactive Jupyter notebook with working Python examples for all API endpoints                                                   |

**Key API patterns:**

- Base URL: `{host}/sasexec` or `{host}/SASStudio/{version}/sasexec`
- Auth: `RemoteSession-Id` header required for all requests. Cookie requirements differ: **production** requires an authorization token cookie (from the SAS Studio login flow) on **every** request including session creation; **dev instance** requires no authorization cookie.
- File paths: Use `~~ds~~` prefix (e.g., `/workspace/~~ds~~/path/to/file`)
- Libraries: `/libdata/{sessionId}/libraries` endpoint
- Code execution: `POST /sessions/{id}/asyncSubmissions` → poll `/messages/longpoll`

### API Exploration via Playwright

Agents can use the `playwright-cli` skill to explore SAS Studio Web API behavior interactively:

```bash
# Load the skill first
/skill playwright-cli

# Then navigate to the SAS Studio instance
/playwright-cli open http://192.168.0.141/SASStudio/38
```

This opens a browser to the local SAS Studio instance where you can observe actual API calls, inspect network traffic, and verify endpoint behavior while working on `studioweb` connection features.

## SAS Server SSH Access

The SAS server is also accessible via SSH:

- **Host:** `192.168.0.141`
- **Username:** `sasdemo`
- **Command:** `ssh sasdemo@192.168.0.141`

SSH access is useful for inspecting server-side logs, running SAS commands directly, or debugging connection issues outside of the extension.

## Fork Maintenance

This repo is a personal fork (`sasstudio-web`) of [sassoftware/vscode-sas-extension](https://github.com/sassoftware/vscode-sas-extension). Naming convention:

| Item | Value |
|---|---|
| Branch | `sasstudio-web` |
| Version | `{upstream}-sasstudio-web.{patch}` (e.g. `1.19.0-sasstudio-web.1`) |
| Fork changelog | `CHANGELOG-SASSTUDIO-WEB.md` |
| Upstream changelog | `CHANGELOG.md` (do not add fork entries here) |

### Syncing with upstream

Use the single rebase script — it handles backup, fetch, rebase, and version bump:

```bash
# First run: creates backup tag, fetches upstream, starts rebase
./scripts/rebase-upstream.sh

# If conflicts occur: resolve them, then re-run the same script
./scripts/rebase-upstream.sh

# Push after successful rebase
git push --force-with-lease origin sasstudio-web
```

The script detects in-progress rebases automatically. Backup tags are created as `pre-rebase/{timestamp}` — restore with `git reset --hard pre-rebase/...` if needed.

## Do Not

- Do not commit until the user explicitly ask for
