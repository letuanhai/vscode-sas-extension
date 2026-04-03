- [x] 1. File contents pane bugs (1a–1g)
- [x] 2. Drag-and-drop of untitled file uploads entire local root filesystem
- [x] 3. Drag-and-drop confirmation message
- [x] 4. Support opening SAS dataset (.sas7bdat) file in data view
- [x] 5. Support read/write with server encoding (not UTF-8)
     Approach: delegate encoding to VS Code's built-in encoding system so the status bar matches server reality.
     Users configure per-language encoding in VS Code settings (e.g., `"[sas]": { "files.encoding": "iso88591" }`).
  - [x] 5.1. Read: return raw bytes from server (stop decoding in adapter), let VS Code decode using its encoding config
  - [x] 5.2. Write: VS Code passes bytes in the document's encoding to `writeFile`. Get encoding from `TextDocument.encoding`, decode to string, send as UTF-8 body with `?encoding=<server encoding name>` param so server transcodes back. Requires a VS Code↔SAS encoding name mapper (e.g., `iso88591` → `ISO-8859-1`).
- [x] 6. Quick File Browser — `SAS.server.quickBrowse` command; `Shift+Enter` reveals highlighted item in SAS sidebar file tree; `$(list-tree)` per-item button does the same inline
     A keyboard-friendly file browser using `window.createQuickPick()` that composes the existing `ContentModel`/`ContentAdapter` without modifying tree view code. Provides fuzzy filtering, absolute path jumping, and fast drill-down navigation. - [x] 6.1 fix reveal file functions - [x] 6.2 add quickinput key bindings: Tab to put currently focused item name in input box, Alt/Option+C to copy the focused item path (uri) - [x] 6.3 fix placeholder text: only keep type to filter and enter absolute path - [x] 6.4 close quick browser after reveal - [x] 6.5 change absolute path handling: show parent folder with filename in filter - [x] 6.6 if current active editor is a file on SAS server (opended from SAS extension) then put the file path (uri) as the initial value in the quick input - [x] 6.7 add history/bookmarks for quick file browser - [-] 6.8 allow configuring root browsing path: no need, just use bookmark - [x] 6.9 change item description: for folder show last modified timestamp, for file show file size and last modified timestamp, for the '..' (go back) item, show the number of files and folders in current folder - [x] 6.10 fix bookmark button/command moving focus to top of item list - [x] 6.11 fix reveal: when loading absolute path items, need to perform a folder navigation before reveal work - [x] 6.12 quick browser state persistence and active editor entry - [x] 6.13 Add an item call Copy SAS Server Path to the tab title context menu of SAS server files that will copy the file's uri to clipboard (this is needed because 'Copy Path' on Windows will change the path separator from "/" to "\", the added entry should copy the file uri verbatim); also rename 'Reload from Server' to 'Reload from SAS Server' in the tab title context menu
- [-] 7. add actions (to map keybinding) to focus sas sidebar file content/libraries section: already added
- [x] 8. add actions/buttons to create new file/folder in the file content tree
- [-] 9. fix sas sidebar file content/libraries section filtering: no need seems to work as expected, keep collapsed folders that is not loaded yet or containing matches
- [x] 10. show output dataset from submission
  - [x] 10.1. show links/buttons that can be used to open the output tables directly
- [x] 11. show error messages noti when http error code
- [x] 12. add command + button to reload SAS tables and command to force reload SAS server file from server (discard unsaved changes)
  - [x] 12.1. `SAS.server.reloadFromServer` / `SAS.content.reloadFromServer`: discard unsaved editor changes, reload file from server; asks confirmation when dirty
  - [x] 12.2. `SAS.reloadActiveDataViewer`: reload data in the currently active DataViewer panel (also button in editor title bar when DataViewer is focused)
  - [x] 12.3. `SAS.reloadAllDataViewers`: reload data in all open DataViewer panels (button in library panel toolbar)
  - [x] 12.4. DataViewer tab stays in place on reload (reuse existing panel, reset via message instead of destroy+recreate)
  - [x] 12.5. DataViewer bottom padding so last row is not hidden by status bar
- [x] 13. bug: Copy SAS Server Path always copy path of active editor, even when running from different tab's context menu
- [-] 14. Log output has no color on windows: log output highlighting is only available when using SAS color schemes
- [x] 15. Change Result pane title to Result-Filename to know which result pane is for which program
- [ ] 16. Improve DataViewer panel — see `docs/task-16-dataviewer-improvement-spec.md` for full spec
  - [x] 16.1. Custom cell/row/column/range selection layer with Ctrl/Cmd+C copy (useSelection.ts)
  - [x] 16.2. Column management tab (ColumnManager.tsx + TabBar.tsx) — search, visibility toggles, copy column names
  - [ ] 16.3. SQLite3 Editor integration — generate CREATE TABLE + INSERT SQL, copy to clipboard or execute via query-editor
