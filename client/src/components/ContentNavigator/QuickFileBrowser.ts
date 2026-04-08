// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  QuickInputButton,
  QuickPickItemKind,
  ThemeIcon,
  Uri,
  commands,
  window,
} from "vscode";

import { ContentModel } from "./ContentModel";
import { QuickFileBrowserStore, StoredItem } from "./QuickFileBrowserStore";
import { ContentItem, Link } from "./types";

// Module-level active item — lets the keybinding command (`SAS.server.quickBrowseReveal`)
// read which file/folder is currently highlighted in the QuickPick.
let _activeItem: ContentItem | undefined;
export function getActiveItem(): ContentItem | undefined {
  return _activeItem;
}

// Module-level active QuickPick — lets keybinding commands (`SAS.server.quickBrowseTabItem`)
// write to the QuickPick's input value while it is open.
let _activeQp: BrowserQuickPick | undefined;
export function getActiveQuickPick(): BrowserQuickPick | undefined {
  return _activeQp;
}

// Module-level stored item — set when a history/bookmark item is active.
let _activeStoredItem: StoredItem | undefined;
export function getActiveStoredItem(): StoredItem | undefined {
  return _activeStoredItem;
}

// Module-level refresh callback — allows commands to trigger an item refresh.
let _refreshItems: (() => void) | undefined;

// Module-level store reference — allows commands to interact with the store.
let _currentStore: QuickFileBrowserStore | undefined;

// Module-level go home callback — allows commands to return to root.
let _goHome: (() => void) | undefined;

// Called by the quickBrowseBookmarkItem command (Alt+B keybinding).
// Toggles bookmark on the currently active folder/file item and refreshes the list.
export function toggleBookmarkActiveItem(): void {
  const item = _activeItem;
  if (item && _currentStore) {
    _currentStore.toggleBookmark(item, isFolder(item));
    _refreshItems?.();
  }
}

// Called by the quickBrowseHome command (Alt+H keybinding).
// Returns to the root level of the quick file browser.
export function goHome(): void {
  _goHome?.();
}

// Button shown on each file/folder item — clicking it reveals the item in the
// SAS sidebar file tree without closing the QuickPick.
const REVEAL_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon("list-tree"),
  tooltip: "Reveal in SAS File Tree (or press Alt+Enter)",
};

const BOOKMARK_ADD_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon("star"),
  tooltip: "Add to Bookmarks",
};
const BOOKMARK_REMOVE_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon("star-full"),
  tooltip: "Remove from Bookmarks",
};
const REMOVE_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon("close"),
  tooltip: "Remove",
};

const CLEAR_HISTORY_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon("clear-all"),
  tooltip: "Clear Recent History",
};

const HOME_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon("home"),
  tooltip: "Back to start (Server Files, Bookmarks, History)",
};

// ---------------------------------------------------------------------------
// Exported pure helpers (testable without vscode)
// ---------------------------------------------------------------------------

export function syntheticFolder(path: string): ContentItem {
  const name =
    path === "/" ? "/" : (path.split("/").filter(Boolean).pop() ?? path);
  const link: Link = {
    method: "GET",
    rel: "getDirectoryMembers",
    href: path,
    uri: path,
    type: "GET",
  };
  return {
    id: `synthetic:${path}`,
    uri: path,
    name,
    links: [link],
    creationTimeStamp: 0,
    modifiedTimeStamp: 0,
    permission: { write: false, delete: false, addMember: false },
  };
}

/** Returns the parent path of a server URI, or undefined if already at root level. */
export function deriveParentPath(uri: string): string | undefined {
  const normalized =
    uri.length > 1 && uri.endsWith("/") ? uri.slice(0, -1) : uri;
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return undefined;
  }
  return normalized.slice(0, lastSlash);
}

export function isFolder(item: ContentItem): boolean {
  return (
    item.links?.some((l) => l.rel === "getDirectoryMembers") === true ||
    item.type === "folder"
  );
}

export function sortContentItems(items: ContentItem[]): ContentItem[] {
  const folders = items
    .filter(isFolder)
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = items
    .filter((i) => !isFolder(i))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

/** Format a byte count into a human-readable string. Returns "" for 0 or negative. */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Format a Unix millisecond timestamp to "YYYY-MM-DD HH:MM". Returns "" for 0. */
export function formatTimestamp(ts: number): string {
  if (!ts) {
    return "";
  }
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-CA"); // "YYYY-MM-DD"
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }); // "HH:MM"
  return `${date} ${time}`;
}

// ---------------------------------------------------------------------------
// QuickPick item types
//
// vscode's QuickPickItem declares `kind?: QuickPickItemKind` (an enum), so
// we cannot simply intersect QuickPickItem with our string-literal `kind`
// discriminant. Instead we build each variant from scratch, carrying all the
// QuickPickItem fields we actually need (label, description, detail) plus our
// own discriminant `kind`.  We then cast the QuickPick to use these variants.
// ---------------------------------------------------------------------------

interface ParentItem {
  kind: "parent";
  label: string;
  iconPath?: ThemeIcon;
  detail?: string;
}

interface FolderItem {
  kind: "folder";
  label: string;
  iconPath: ThemeIcon;
  detail?: string;
  item: ContentItem;
  buttons: readonly QuickInputButton[];
}

interface FileItem {
  kind: "file";
  label: string;
  // ThemeIcon.File + resourceUri: VS Code resolves from the active file icon theme.
  // { light, dark } iconPath: explicit override (e.g. for .sas7bdat).
  iconPath: ThemeIcon | { light: Uri; dark: Uri };
  resourceUri: Uri;
  description: string; // always "" — suppresses the auto-generated path from resourceUri
  detail?: string;
  item: ContentItem;
  buttons: readonly QuickInputButton[];
}

interface GotoItem {
  kind: "goto";
  label: string;
  description: string;
  alwaysShow: true;
  path: string;
  filterText: string;
}

interface HistoryItem {
  kind: "history";
  label: string;
  iconPath: ThemeIcon | { light: Uri; dark: Uri };
  resourceUri?: Uri;
  description?: string;
  storedItem: StoredItem;
  buttons: readonly QuickInputButton[];
}

interface BookmarkItem {
  kind: "bookmark";
  label: string;
  iconPath: ThemeIcon | { light: Uri; dark: Uri };
  resourceUri?: Uri;
  description?: string;
  storedItem: StoredItem;
  buttons: readonly QuickInputButton[];
}

interface ActiveEditorItem {
  kind: "activeEditor";
  label: string; // filename from URI
  iconPath: ThemeIcon | { light: Uri; dark: Uri };
  resourceUri?: Uri;
  description: string; // full server path
  detail: string; // "Active Editor"
  serverPath: string; // the URI path for navigation
}

type BrowserQuickPickItem =
  | ParentItem
  | FolderItem
  | FileItem
  | GotoItem
  | HistoryItem
  | BookmarkItem
  | ActiveEditorItem;

// QuickPick<T> requires T extends QuickPickItem. Our BrowserQuickPickItem
// fails that constraint because the string-literal `kind` discriminant
// conflicts with `kind?: QuickPickItemKind` on QuickPickItem. We therefore
// define a minimal structural alias covering only the members we use and cast
// at the call site.
interface BrowserQuickPick {
  readonly selectedItems: readonly BrowserQuickPickItem[];
  activeItems: readonly BrowserQuickPickItem[];
  items: BrowserQuickPickItem[];
  value: string;
  title: string | undefined;
  placeholder: string | undefined;
  busy: boolean;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  ignoreFocusOut: boolean;
  onDidAccept(listener: () => void): { dispose(): void };
  onDidChangeActive(
    listener: (items: readonly BrowserQuickPickItem[]) => void,
  ): { dispose(): void };
  onDidChangeValue(listener: (value: string) => void): { dispose(): void };
  onDidHide(listener: () => void): { dispose(): void };
  onDidTriggerItemButton(
    listener: (e: {
      button: QuickInputButton;
      item: BrowserQuickPickItem;
    }) => void,
  ): { dispose(): void };
  buttons: readonly QuickInputButton[];
  onDidTriggerButton(listener: (button: QuickInputButton) => void): {
    dispose(): void;
  };
  show(): void;
  hide(): void;
  dispose(): void;
}

/** Returns a stable key for preserving active-item focus across item list refreshes. */
export function itemKey(item: BrowserQuickPickItem): string | undefined {
  if (item.kind === "folder" || item.kind === "file") {
    return item.item.uri;
  }
  if (item.kind === "history" || item.kind === "bookmark") {
    return item.storedItem.uri;
  }
  if (item.kind === "parent") {
    return "__parent__";
  }
  if (item.kind === "activeEditor") {
    return "__activeEditor__";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// QuickFileBrowser class
// ---------------------------------------------------------------------------

export default class QuickFileBrowser {
  private contentModel: ContentModel;
  private onReveal: ((item: ContentItem) => void) | undefined;
  private extensionUri: Uri | undefined;
  private store: QuickFileBrowserStore | undefined;

  // Saved state for persistence across browser sessions
  private savedFolderUri: string | undefined;
  private savedActiveKey: string | undefined;

  constructor(
    contentModel: ContentModel,
    onReveal?: (item: ContentItem) => void,
    extensionUri?: Uri,
    store?: QuickFileBrowserStore,
  ) {
    this.contentModel = contentModel;
    this.onReveal = onReveal;
    this.extensionUri = extensionUri;
    this.store = store;
  }

  /**
   * Clears the saved browse state (stack, cache, active key).
   * Called when explicitly navigating home or when the browser is disposed.
   */
  clearState(): void {
    this.savedFolderUri = undefined;
    this.savedActiveKey = undefined;
  }

  async show(arg?: ContentItem | string): Promise<void> {
    // window.createQuickPick() returns QuickPick<QuickPickItem>; we widen it to
    // our BrowserQuickPick type which uses a string-literal `kind` discriminant.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const qp = window.createQuickPick() as unknown as BrowserQuickPick;
    _activeQp = qp;
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.ignoreFocusOut = true;
    qp.placeholder = "Type to filter  ·  / enter absolute path";

    // Navigation stack: last element is the current folder; empty = root
    const stack: ContentItem[] = [];

    // Filter text to pre-fill after the next navigation (set by goto acceptance)
    let nextFilter = "";

    // Determine initial folder from argument
    const hasExplicitArg = arg !== undefined;
    if (typeof arg === "string") {
      stack.push(syntheticFolder(arg));
    } else if (arg !== undefined) {
      stack.push(arg);
    } else if (this.savedFolderUri) {
      // Restore saved folder: navigate to it with a fresh API call
      stack.push(syntheticFolder(this.savedFolderUri));
    }

    // Per-session cache: populated on each load so refreshItems() (bookmark
    // toggles) can rebuild items without an extra network call.
    // Navigation always fetches fresh from server; cache is never used for that.
    const cache = new Map<string, ContentItem[]>();

    // Monotonic version counter used to discard stale async responses
    const version = { current: 0 };

    const currentFolder = (): ContentItem | undefined =>
      stack.length > 0 ? stack[stack.length - 1] : undefined;

    // Active key to restore on first load after reopening (consumed once).
    let restoreKey: string | undefined =
      !hasExplicitArg && this.savedFolderUri ? this.savedActiveKey : undefined;

    const reload = (): void => {
      version.current += 1;
      const v = version.current;
      const filter = nextFilter;
      const key = restoreKey;
      restoreKey = undefined; // consume once; subsequent navigations pass undefined
      nextFilter = "";
      void this.loadFolder(
        currentFolder(),
        qp,
        stack,
        cache,
        version,
        v,
        filter,
        this.store,
        key,
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // If restoring a saved folder fails, clear stack and reload from root
        if (stack.length > 0) {
          stack.length = 0;
          this.clearState();
          reload();
        }
        void window.showErrorMessage(`QuickFileBrowser error: ${msg}`);
      });
    };

    // Rebuild items for the current folder without bumping the version counter
    // (uses cached data if available). Used after bookmark/history changes.
    const refreshItems = (): void => {
      void this.loadFolder(
        currentFolder(),
        qp,
        stack,
        cache,
        version,
        version.current,
        qp.value,
        this.store,
      ).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        void window.showErrorMessage(`QuickFileBrowser error: ${msg}`);
      });
    };

    _refreshItems = refreshItems;
    _currentStore = this.store;

    qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      if (!selected) {
        return;
      }

      if (selected.kind === "parent") {
        const popped = stack.pop();
        if (stack.length === 0 && popped) {
          const parentPath = deriveParentPath(popped.uri);
          if (parentPath !== undefined) {
            stack.push(syntheticFolder(parentPath));
          }
        }
        reload();
      } else if (selected.kind === "folder") {
        stack.push(selected.item);
        reload();
      } else if (selected.kind === "goto") {
        nextFilter = selected.filterText;
        stack.push(syntheticFolder(selected.path));
        reload();
      } else if (selected.kind === "file") {
        const fileItem = selected.item;
        qp.busy = true;
        this.contentModel
          .getUri(fileItem, false)
          .then((uri: Uri) => {
            this.store?.pushHistory(fileItem, false, uri.toString());
            return commands.executeCommand("SAS.server.openItem", uri);
          })
          .then(() => {
            qp.hide();
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            void window.showErrorMessage(`Failed to open file: ${msg}`);
            qp.busy = false;
          });
      } else if (selected.kind === "activeEditor") {
        // Navigate to the file's parent folder and pre-filter to the filename
        const parentPath = deriveParentPath(selected.serverPath);
        const filename =
          selected.serverPath.split("/").filter(Boolean).pop() ?? "";
        if (parentPath !== undefined) {
          stack.push(syntheticFolder(parentPath));
          nextFilter = filename;
          reload();
        }
      } else if (selected.kind === "history" || selected.kind === "bookmark") {
        const s = selected.storedItem;
        if (s.isFolder) {
          stack.push(syntheticFolder(s.uri));
          reload();
        } else {
          // Open file: use cached vsUri if available (history entries), otherwise
          // construct the sasServer URI directly from the stored server path.
          qp.busy = true;
          const openUri: Promise<Uri> = Promise.resolve(
            s.vsUri
              ? Uri.parse(s.vsUri)
              : Uri.parse(
                  `sasServer:${s.uri.replace(/#/g, "%23").replace(/\?/g, "%3F")}`,
                ),
          );
          openUri
            .then((uri) => commands.executeCommand("SAS.server.openItem", uri))
            .then(() => {
              qp.hide();
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              void window.showErrorMessage(`Failed to open file: ${msg}`);
              qp.busy = false;
            });
        }
      }
    });

    qp.onDidChangeValue((value: string) => {
      if (value.startsWith("/")) {
        const lastSlash = value.lastIndexOf("/");
        const dir = value.slice(0, lastSlash + 1) || "/";
        const base = value.slice(lastSlash + 1);
        const gotoItem: GotoItem = {
          kind: "goto",
          label: `$(arrow-right) Go to ${dir}`,
          description: base ? `· filter: ${base}` : "Navigate to path",
          alwaysShow: true,
          path: dir,
          filterText: base,
        };
        // Replace any existing goto item at the top; keep all non-goto items
        const existing = qp.items.filter((i) => i.kind !== "goto");
        qp.items = [gotoItem, ...existing];
      } else {
        // Remove goto item if user cleared the leading slash
        const withoutGoto = qp.items.filter((i) => i.kind !== "goto");
        if (withoutGoto.length !== qp.items.length) {
          qp.items = withoutGoto;
        }
      }
    });

    qp.onDidChangeActive((active) => {
      const first = active[0];
      _activeItem =
        first?.kind === "folder" || first?.kind === "file"
          ? first.item
          : undefined;
      _activeStoredItem =
        first?.kind === "history" || first?.kind === "bookmark"
          ? first.storedItem
          : undefined;
      // Update saved active key for persistence
      this.savedActiveKey = first ? itemKey(first) : undefined;
    });

    qp.onDidTriggerButton((btn) => {
      if (btn === CLEAR_HISTORY_BUTTON) {
        this.store?.clearHistory();
        refreshItems();
      } else if (btn === HOME_BUTTON) {
        stack.length = 0;
        this.clearState();
        reload();
      }
    });

    qp.onDidTriggerItemButton((e) => {
      const it = e.item;
      const btn = e.button;

      if (btn === REMOVE_BUTTON) {
        if (it.kind === "history") {
          this.store?.removeHistory(it.storedItem.uri);
          refreshItems();
        } else if (it.kind === "bookmark") {
          this.store?.removeBookmark(it.storedItem.uri);
          refreshItems();
        }
        return;
      }

      if (btn === BOOKMARK_ADD_BUTTON || btn === BOOKMARK_REMOVE_BUTTON) {
        if (it.kind === "folder" || it.kind === "file") {
          const isFile = it.kind === "file";
          const adding = !this.store?.isBookmarked(it.item.uri);
          if (isFile && adding) {
            // Eagerly fetch vsUri so the bookmark can be opened later without a
            // live server call (which would fail on the synthetic ContentItem).
            this.contentModel
              .getUri(it.item, false)
              .then((uri) => {
                this.store?.addBookmark(it.item, false, uri.toString());
                refreshItems();
              })
              .catch(() => {
                // Fallback: store without vsUri (open will still try getUri later)
                this.store?.addBookmark(it.item, false);
                refreshItems();
              });
          } else {
            this.store?.toggleBookmark(it.item, it.kind === "folder");
            refreshItems();
          }
        }
        return;
      }

      // REVEAL_BUTTON
      if ((it.kind === "folder" || it.kind === "file") && this.onReveal) {
        this.onReveal(it.item);
        qp.hide();
      }
    });

    qp.onDidHide(() => {
      // Save state for persistence across browser sessions
      this.savedFolderUri = currentFolder()?.uri;
      this.savedActiveKey = qp.activeItems[0]
        ? itemKey(qp.activeItems[0])
        : undefined;

      _activeQp = undefined;
      _activeItem = undefined;
      _activeStoredItem = undefined;
      _refreshItems = undefined;
      _currentStore = undefined;
      _goHome = undefined;
      void commands.executeCommand("setContext", "SAS.quickBrowseOpen", false);
      qp.dispose();
    });

    // Set up go home callback for the keybinding command
    _goHome = () => {
      stack.length = 0;
      this.clearState();
      reload();
    };

    void commands.executeCommand("setContext", "SAS.quickBrowseOpen", true);
    qp.show();

    reload();
  }

  private async loadFolder(
    folder: ContentItem | undefined,
    qp: BrowserQuickPick,
    stack: ContentItem[],
    cache: Map<string, ContentItem[]>,
    version: { current: number },
    expectedVersion: number,
    initialFilter = "",
    store?: QuickFileBrowserStore,
    restoreActiveKey?: string,
  ): Promise<void> {
    qp.busy = true;

    const cacheKey = folder?.uri ?? "root";

    // Always fetch fresh from server — never serve stale cached data on navigation.
    const children = await this.contentModel.getChildren(folder);

    // Guard against stale responses delivered after a newer navigation
    if (version.current !== expectedVersion) {
      return;
    }

    cache.set(cacheKey, children);
    qp.busy = false;

    // Update title to reflect current path
    const currentPath = folder?.uri ?? "/";
    qp.title =
      currentPath === "/" || currentPath === "root"
        ? "SAS Server"
        : currentPath;
    qp.placeholder = "Type to filter  ·  / enter absolute path";

    const sorted = sortContentItems(children);

    const folderCount = sorted.filter(isFolder).length;
    const fileCount = sorted.filter((i) => !isFolder(i)).length;
    const parts: string[] = [];
    if (folderCount > 0) {
      parts.push(`${folderCount} ${folderCount === 1 ? "folder" : "folders"}`);
    }
    if (fileCount > 0) {
      parts.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`);
    }
    const parentDescription = parts.join(", ") || "empty";

    const parentItems: ParentItem[] =
      stack.length > 0
        ? [
            {
              kind: "parent",
              label: "..",
              iconPath: new ThemeIcon("arrow-left"),
              detail: parentDescription,
            },
          ]
        : [];

    const folderItems: FolderItem[] = sorted.filter(isFolder).map((item) => ({
      kind: "folder" as const,
      label: item.name,
      iconPath: new ThemeIcon("folder"),
      detail: formatTimestamp(item.modifiedTimeStamp) || undefined,
      item,
      buttons: [
        store?.isBookmarked(item.uri)
          ? BOOKMARK_REMOVE_BUTTON
          : BOOKMARK_ADD_BUTTON,
        REVEAL_BUTTON,
      ],
    }));

    const fileItems: FileItem[] = sorted
      .filter((item) => !isFolder(item))
      .map((item) => {
        const sizePart = formatFileSize(item.fileStat?.size ?? 0);
        const timePart = formatTimestamp(item.modifiedTimeStamp);
        const description = [sizePart, timePart].filter(Boolean).join(" · ");
        return {
          kind: "file" as const,
          label: item.name,
          iconPath: this.iconPathForFile(item.name),
          resourceUri: Uri.file(item.name),
          description: "",
          detail: description || undefined,
          item,
          buttons: [
            store?.isBookmarked(item.uri)
              ? BOOKMARK_REMOVE_BUTTON
              : BOOKMARK_ADD_BUTTON,
            REVEAL_BUTTON,
          ],
        };
      });

    // Only add history/bookmarks at root level
    const suffixItems: BrowserQuickPickItem[] = [];
    if (stack.length === 0 && store) {
      const bookmarks = store.getBookmarks();
      const history = store.getHistory();

      if (bookmarks.length > 0) {
        suffixItems.push(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          {
            kind: QuickPickItemKind.Separator,
            label: "Bookmarks",
          } as unknown as BrowserQuickPickItem,
        );
        for (const b of bookmarks) {
          suffixItems.push({
            kind: "bookmark",
            label: b.name,
            iconPath: b.isFolder
              ? new ThemeIcon("folder")
              : this.iconPathForFile(b.name),
            resourceUri: b.isFolder ? undefined : Uri.file(b.name),
            description: b.uri,
            storedItem: b,
            buttons: [REMOVE_BUTTON],
          } satisfies BookmarkItem);
        }
      }

      if (history.length > 0) {
        suffixItems.push(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          {
            kind: QuickPickItemKind.Separator,
            label: "Recent",
          } as unknown as BrowserQuickPickItem,
        );
        for (const h of history) {
          suffixItems.push({
            kind: "history",
            label: h.name,
            iconPath: h.isFolder
              ? new ThemeIcon("folder")
              : this.iconPathForFile(h.name),
            resourceUri: h.isFolder ? undefined : Uri.file(h.name),
            description: h.uri,
            storedItem: h,
            buttons: [REMOVE_BUTTON],
          } satisfies HistoryItem);
        }
      }
    }

    // Active editor item at root level (when active editor is a SAS server file)
    const activeEditorItems: BrowserQuickPickItem[] = [];
    if (stack.length === 0) {
      const activeUri = window.activeTextEditor?.document.uri;
      if (
        activeUri?.scheme === "sasServer" ||
        activeUri?.scheme === "sasServerReadOnly"
      ) {
        const filename = activeUri.path.split("/").filter(Boolean).pop() ?? "";
        activeEditorItems.push({
          kind: "activeEditor",
          label: filename,
          iconPath: this.iconPathForFile(filename),
          resourceUri: Uri.file(filename),
          description: activeUri.path,
          detail: "Active Editor",
          serverPath: activeUri.path,
        } satisfies ActiveEditorItem);
      }
    }

    // "Server Files" separator appears at the top when supplementary sections exist
    const serverFilesSep: BrowserQuickPickItem[] =
      suffixItems.length > 0 || activeEditorItems.length > 0
        ? [
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            {
              kind: QuickPickItemKind.Separator,
              label: "Server Files",
            } as unknown as BrowserQuickPickItem,
          ]
        : [];

    // Capture the currently active item so we can restore focus after replacing items.
    // VS Code resets focus to the first item whenever qp.items is reassigned.
    const prevKey =
      qp.activeItems[0] !== undefined ? itemKey(qp.activeItems[0]) : undefined;

    qp.items = [
      ...activeEditorItems,
      ...serverFilesSep,
      ...parentItems,
      ...folderItems,
      ...fileItems,
      ...suffixItems,
    ];

    // Restore focus: prefer the saved active key on reopen, otherwise restore
    // the previously active item for same-folder refreshes (e.g. bookmark toggle).
    // If neither matches any item, VS Code leaves focus on the first item.
    const focusTarget = restoreActiveKey ?? prevKey;
    if (focusTarget !== undefined) {
      const found = qp.items.find((i) => itemKey(i) === focusTarget);
      if (found !== undefined) {
        qp.activeItems = [found];
      }
    }

    // Set title buttons: HOME_BUTTON when navigating, CLEAR_HISTORY at root with history
    if (stack.length > 0) {
      qp.buttons = [HOME_BUTTON];
    } else if (store) {
      const history = store.getHistory();
      qp.buttons = history.length > 0 ? [CLEAR_HISTORY_BUTTON] : [];
    } else {
      qp.buttons = [];
    }

    // Set the text filter: pre-fill with initialFilter (e.g. filename from a goto),
    // or clear it so the new directory's items show unfiltered.
    qp.value = initialFilter;
  }

  private iconPathForFile(name: string): ThemeIcon | { light: Uri; dark: Uri } {
    if (this.extensionUri && name.toLowerCase().endsWith(".sas7bdat")) {
      return {
        dark: Uri.joinPath(this.extensionUri, "icons/dark/sasDataSetDark.svg"),
        light: Uri.joinPath(
          this.extensionUri,
          "icons/light/sasDataSetLight.svg",
        ),
      };
    }
    return ThemeIcon.File;
  }
}
