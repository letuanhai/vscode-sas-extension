// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { QuickInputButton, ThemeIcon, Uri, commands, window } from "vscode";

import { ContentModel } from "./ContentModel";
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

// Button shown on each file/folder item — clicking it reveals the item in the
// SAS sidebar file tree without closing the QuickPick.
const REVEAL_BUTTON: QuickInputButton = {
  iconPath: new ThemeIcon("list-tree"),
  tooltip: "Reveal in SAS File Tree (or press Alt+Enter)",
};

// ---------------------------------------------------------------------------
// Exported pure helpers (testable without vscode)
// ---------------------------------------------------------------------------

export function syntheticFolder(path: string): ContentItem {
  const name =
    path === "/" ? "/" : path.split("/").filter(Boolean).pop() ?? path;
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
  description?: string;
}

interface FolderItem {
  kind: "folder";
  label: string;
  iconPath: ThemeIcon;
  description: string;
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
  description?: string;
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

type BrowserQuickPickItem = ParentItem | FolderItem | FileItem | GotoItem;

// QuickPick<T> requires T extends QuickPickItem. Our BrowserQuickPickItem
// fails that constraint because the string-literal `kind` discriminant
// conflicts with `kind?: QuickPickItemKind` on QuickPickItem. We therefore
// define a minimal structural alias covering only the members we use and cast
// at the call site.
interface BrowserQuickPick {
  readonly selectedItems: readonly BrowserQuickPickItem[];
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
  show(): void;
  hide(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// QuickFileBrowser class
// ---------------------------------------------------------------------------

export default class QuickFileBrowser {
  private contentModel: ContentModel;
  private onReveal: ((item: ContentItem) => void) | undefined;
  private extensionUri: Uri | undefined;

  constructor(
    contentModel: ContentModel,
    onReveal?: (item: ContentItem) => void,
    extensionUri?: Uri,
  ) {
    this.contentModel = contentModel;
    this.onReveal = onReveal;
    this.extensionUri = extensionUri;
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

    // Determine initial folder from argument
    if (typeof arg === "string") {
      stack.push(syntheticFolder(arg));
    } else if (arg !== undefined) {
      stack.push(arg);
    }

    // Per-session cache keyed by folder URI (or "root" for the root listing)
    const cache = new Map<string, ContentItem[]>();

    // Filter text to pre-fill after the next navigation (set by goto acceptance)
    let nextFilter = "";

    // Monotonic version counter used to discard stale async responses
    const version = { current: 0 };

    const currentFolder = (): ContentItem | undefined =>
      stack.length > 0 ? stack[stack.length - 1] : undefined;

    const reload = (): void => {
      version.current += 1;
      const v = version.current;
      const filter = nextFilter;
      nextFilter = "";
      void this.loadFolder(currentFolder(), qp, stack, cache, version, v, filter).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          void window.showErrorMessage(`QuickFileBrowser error: ${msg}`);
        },
      );
    };

    qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      if (!selected) {
        return;
      }

      if (selected.kind === "parent") {
        stack.pop();
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
          .then((uri: Uri) =>
            commands.executeCommand("SAS.server.openItem", uri),
          )
          .then(() => {
            qp.hide();
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            void window.showErrorMessage(`Failed to open file: ${msg}`);
            qp.busy = false;
          });
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
    });

    qp.onDidTriggerItemButton((e) => {
      const it = e.item;
      if ((it.kind === "folder" || it.kind === "file") && this.onReveal) {
        this.onReveal(it.item);
        qp.hide();
      }
    });

    qp.onDidHide(() => {
      _activeQp = undefined;
      _activeItem = undefined;
      void commands.executeCommand("setContext", "SAS.quickBrowseOpen", false);
      cache.clear();
      qp.dispose();
    });

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
  ): Promise<void> {
    qp.busy = true;

    const cacheKey = folder?.uri ?? "root";

    let children: ContentItem[];
    if (cache.has(cacheKey)) {
      children = cache.get(cacheKey)!;
    } else {
      children = await this.contentModel.getChildren(folder);
    }

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

    const parentItems: ParentItem[] =
      stack.length > 0
        ? [{ kind: "parent", label: "..", iconPath: new ThemeIcon("arrow-left") }]
        : [];

    const folderItems: FolderItem[] = sorted
      .filter(isFolder)
      .map((item) => ({
        kind: "folder" as const,
        label: item.name,
        iconPath: new ThemeIcon("folder"),
        description: item.uri,
        item,
        buttons: [REVEAL_BUTTON],
      }));

    const fileItems: FileItem[] = sorted
      .filter((item) => !isFolder(item))
      .map((item) => ({
        kind: "file" as const,
        label: item.name,
        iconPath: this.iconPathForFile(item.name),
        resourceUri: Uri.file(item.name),
        item,
        buttons: [REVEAL_BUTTON],
      }));

    qp.items = [...parentItems, ...folderItems, ...fileItems];
    // Set the text filter: pre-fill with initialFilter (e.g. filename from a goto),
    // or clear it so the new directory's items show unfiltered.
    qp.value = initialFilter;
  }

  private iconPathForFile(
    name: string,
  ): ThemeIcon | { light: Uri; dark: Uri } {
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
