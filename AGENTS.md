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
npm run package:fork      # package extension as .vsix with combined changelog
npx @vscode/vsce package  # package with original changelog (avoid - use npm run package:fork instead)
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

## Fork Maintenance

This repo is a personal fork (`sasstudio-web`) of [sassoftware/vscode-sas-extension](https://github.com/sassoftware/vscode-sas-extension).

### Version policy

Increment `patch` for fixes, `minor` for new features. The upstream version is no longer reflected in this version number.

### Incorporating upstream changes (cherry-pick workflow)

This fork does **not** rebase onto upstream. Upstream changes are reviewed manually and cherry-picked selectively.

```bash
# See upstream commits not yet in this branch
git log sasstudio-web..main --oneline --format="%h %as %s"

# Cherry-pick a specific commit (resolve conflicts as needed)
git cherry-pick <sha>

# Cherry-pick a range
git cherry-pick <older-sha>^..<newer-sha>
```

After cherry picking a batch of upstream commits:

1. Note the commit hash of picked and last reviewed upstream commits in the commit message.
2. If changes were incorporated, add an entry to `CHANGELOG.md` under Upstream history.

### Packaging

```bash
npx @vscode/vsce package          # produces .vsix in current directory
npx @vscode/vsce publish --pre-release --pat <TOKEN>  # publish to marketplace
```

### Changelog

All changes go directly into `CHANGELOG.md`. Fork-specific entries are at the top; the upstream history is preserved below the `## Upstream history` separator. Do not create a separate fork changelog file.

## Do Not

- Do not commit until the user explicitly ask for
