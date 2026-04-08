# Changelog (sasstudio-web fork)

All notable changes specific to the `sasstudio-web` fork are documented here. For upstream changes, see [CHANGELOG.md](./CHANGELOG.md).

## [1.19.0-sasstudio-web.1] - 2026-04-08

### Added

- Add SAS Studio Web (`studioweb`) connection type — connect to an existing SAS Studio browser session using a session ID and cookie
- Add library navigator support for SAS Studio Web: browse libraries, tables, and SAS views
- Add file/server pane support for SAS Studio Web: browse, create, rename, move, delete, upload, and download server files
- Add data viewer support for SAS Studio Web tables (with row/column counts and column format info)
- Add ability to open `.sas7bdat` files from the file pane directly in the data viewer (SAS Studio Web)
- Add QuickFileBrowser (`Ctrl+Shift+E`) — keyboard-driven fuzzy file navigator for SAS Studio Web server files, with `Shift+Enter` to reveal in tree
- Add state persistence to QuickFileBrowser — remembers last visited directory and bookmarks
- Show output datasets produced by a submission in the SAS log panel (SAS Studio Web)
- Distinguish SAS views from tables in the library navigator (SAS Studio Web)
- Support server-side text encoding when reading and writing files (SAS Studio Web)
- Add `SAS.studioweb.newSession` command to re-prompt for session credentials without restarting VS Code
- Add Library Properties feature for SAS libraries — view library details including engine, path, and options
- Add "Reveal in Libraries View" command for DataViewer
- Add "Reveal in SAS File Tree" context menu entry for server files
- Add auto-refresh for content and server views after SAS script execution
- Add SQLite3 Editor integration for DataViewer — view table data in a SQLite editor
- Add column management tab to DataViewer with search and visibility toggles
- Add drag-and-drop column reordering in DataViewer Columns tab
- Add cell/row/column/range selection with copy support in DataViewer
- Add column width controls and reset button to DataViewer
- Add filename with extension to Result pane title
- Add "Copy SAS Server Path" command to tab context menu for server files
- Add "Reload from Server" command (renamed from "Revert from Server") for server files
- Hide temporary libraries (Work, Webwork, etc.) from Libraries view by default

### Fixed

- Show HTTP error notifications (with method + URL) for all failed API calls via axios response interceptor (SAS Studio Web)
- Fix submission cancel to send `DELETE` with the correct bare submission UUID
- Open server tree items in persistent editor tabs; fix tab matching by full URI
- Fix file pane UX: guard against untitled files, duplicate name check on drop, stale cache after rename/move, confirmation on drag-and-drop overwrite
- Fetch server encoding during `ensureCredentials` so it is available for all file operations
- Fix ODS wrapper stripping before submission; fetch HTML results via the `results` link in `SubmitComplete` poll message
- Fix file download corruption by using raw binary path for all file downloads
- Fix binary file upload corruption by sending as `application/octet-stream` with raw write path
- Fix raw write path encoding for non-UTF-8 server encodings
- Fix `_SASPROGRAMFILE` macro variable to use SAS server URI path on StudioWeb connections
- Fix QuickFileBrowser to always fetch fresh items on navigation
- Fix SQLite export column types and trailing spaces in DataViewer
- Fix DataViewer column visibility sync and preserve grid state on tab switch
- Fix DataViewer column ordering in Columns tab
- Fix DataViewer column resize and reset behavior
- Fix tab menu to pass correct URI to `reloadFromServer` and `copyServerPath` commands

### Changed

- Remove browser/web extension build — package desktop (Node) target only for faster builds and smaller VSIX
- Disable Python (Pyright LSP) support — replaced with no-op stub to reduce VSIX size from ~14 MB to ~5 MB
- Replace npm `--flag` build orchestration with `--target=` CLI args to fix npm deprecation warnings
- Exclude typeshed, browser artifacts, and dev files from VSIX packaging (5,389 → 668 files)
