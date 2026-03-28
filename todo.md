- [x] show output dataset from submission
- [x] show error messages noti when http error code
- [ ] add actions (to map keybinding) to focus sas sidebar file content/libraries section
- [ ] add actions/buttons to create new file/folder in the file content tree
- [-] fix sas sidebar file content/libraries section filtering: no need seems to work as expected, keep collapsed folders that is not loaded yet or containing matches

## ✅ Task 6: Quick File Browser (QuickPick-based server file navigation) — branch: feat/task6-quick-file-browser

- [x] fix reveal file functions
- [ ] add quickinput key bindings: Tab to put currently focused item name in input box, Alt/Option+C to copy the focused item path (uri)
- [ ] fix place holder text button name
- [ ] change absolute path handling: show parent folder with filename in filter
- [ ] action to start browsing at current opened editor file path
- [ ] add history/bookmarks for quick file browser
- [ ] allow configuring root browsing path
- [ ] change item description: for folder show number of chilren and last modified time, for file show file size and last modified time; keep item uri as tooltip

A keyboard-friendly file browser using `window.createQuickPick()` that composes the
existing `ContentModel`/`ContentAdapter` without modifying tree view code. Provides
fuzzy filtering, absolute path jumping, and fast drill-down navigation.

---

## Completed tasks (reference)

- ✅ Task 1: File contents pane bugs (1a–1g)
- ✅ Task 2: Drag-and-drop of untitled file uploads entire local root filesystem
- ✅ Task 3: Drag-and-drop confirmation message
- ✅ Task 4: Support opening SAS dataset (.sas7bdat) file in data view
- Task 5: Support read/write with server encoding (not UTF-8)
    - [ ] ready raw bytes
    - [ ] write raw bytes
- Task 6: Quick File Browser — `SAS.server.quickBrowse` command; `Shift+Enter` reveals highlighted item in SAS sidebar file tree; `$(list-tree)` per-item button does the same inline
