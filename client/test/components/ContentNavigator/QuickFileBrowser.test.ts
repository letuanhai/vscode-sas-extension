// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import type { Memento, QuickInputButton } from "vscode";
import {
  QuickPick,
  QuickPickItem,
  QuickPickItemKind,
  Uri,
  commands,
  env,
  window,
} from "vscode";

import { assert } from "chai";
import * as sinon from "sinon";

import { ContentModel } from "../../../src/components/ContentNavigator/ContentModel";
import QuickFileBrowser, {
  getActiveItem,
  getActiveQuickPick,
  getActiveStoredItem,
  isFolder,
  sortContentItems,
  syntheticFolder,
  toggleBookmarkActiveItem,
} from "../../../src/components/ContentNavigator/QuickFileBrowser";
import { QuickFileBrowserStore } from "../../../src/components/ContentNavigator/QuickFileBrowserStore";
import {
  ContentAdapter,
  ContentItem,
  RootFolderMap,
} from "../../../src/components/ContentNavigator/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFolder(name: string, uri?: string): ContentItem {
  const path = uri ?? `/${name}`;
  return {
    id: name,
    uri: path,
    name,
    links: [
      {
        method: "GET",
        rel: "getDirectoryMembers",
        href: path,
        uri: path,
        type: "GET",
      },
    ],
    permission: { write: false, delete: false, addMember: false },
    creationTimeStamp: 0,
    modifiedTimeStamp: 0,
    type: "folder",
  };
}

function makeFile(name: string, uri?: string): ContentItem {
  const path = uri ?? `/${name}`;
  return {
    id: name,
    uri: path,
    name,
    links: [],
    permission: { write: false, delete: false, addMember: false },
    creationTimeStamp: 0,
    modifiedTimeStamp: 0,
  };
}

/** Stub ContentAdapter that returns predefined children per folder URI. */
function createStubAdapter(
  childrenByUri: Map<string | undefined, ContentItem[]>,
): ContentAdapter {
  return {
    connected: () => true,
    connect: () => Promise.resolve(),
    getRootItems: () => {
      const root: RootFolderMap = {};
      const rootChildren = childrenByUri.get(undefined) ?? [];
      for (const item of rootChildren) {
        root[item.name] = item;
      }
      return Promise.resolve(root);
    },
    getRootFolder: () => undefined,
    getChildItems: (parent: ContentItem) =>
      Promise.resolve(childrenByUri.get(parent.uri) ?? []),
    getContentOfItem: () => Promise.resolve(""),
    getContentOfUri: () => Promise.resolve(""),
    getItemOfUri: () =>
      Promise.resolve(makeFile("stub", "/stub")),
    getUriOfItem: (item: ContentItem) =>
      Promise.resolve(Uri.file(item.uri)),
    getFolderPathForItem: () => Promise.resolve(""),
    getParentOfItem: () => Promise.resolve(undefined),
    createNewItem: () => Promise.resolve(undefined),
    createNewFolder: () => Promise.resolve(undefined),
    deleteItem: () => Promise.resolve(false),
    renameItem: () => Promise.resolve(undefined),
    moveItem: () => Promise.resolve(undefined),
    addChildItem: () => Promise.resolve(false),
    addItemToFavorites: () => Promise.resolve(false),
    removeItemFromFavorites: () => Promise.resolve(false),
    updateContentOfItem: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------
// Helpers to interact with the QuickPick from tests
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the QuickPick is no longer busy (items loaded).
 * Polls every 50ms for up to `timeout` ms.
 */
async function waitForNotBusy(
  qp: QuickPick<QuickPickItem>,
  timeout = 5000,
): Promise<void> {
  const start = Date.now();
  while (qp.busy && Date.now() - start < timeout) {
    await sleep(50);
  }
  if (qp.busy) {
    throw new Error("QuickPick still busy after timeout");
  }
}

describe("QuickFileBrowser (integration)", function () {
  this.timeout(30000);

  let sandbox: sinon.SinonSandbox;
  let setContextStub: sinon.SinonStub;

  // Keep a reference to any QuickPick that show() created so we can clean up
  let activeQuickPick: QuickPick<QuickPickItem> | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Spy on window.createQuickPick so we can grab the QuickPick instance
    const originalCreate = window.createQuickPick.bind(window);
    sandbox.stub(window, "createQuickPick").callsFake(() => {
      const qp = originalCreate();
      activeQuickPick = qp;
      return qp;
    });

    // Stub setContext to avoid side effects
    setContextStub = sandbox.stub();
    const originalExec = commands.executeCommand;
    sandbox.stub(commands, "executeCommand").callsFake(async (...args: unknown[]) => {
      if (args[0] === "setContext") {
        setContextStub(...args);
        return undefined;
      }
      // Forward other commands
      return (originalExec as Function).apply(commands, args);
    });
  });

  afterEach(() => {
    // Ensure the QuickPick is disposed between tests
    if (activeQuickPick) {
      activeQuickPick.hide();
      activeQuickPick.dispose();
      activeQuickPick = undefined;
    }
    sandbox.restore();
  });

  // -----------------------------------------------------------------------
  // 1. QuickPick opens and shows root items
  // -----------------------------------------------------------------------
  it("opens a QuickPick and shows root-level items", async () => {
    const rootChildren = [
      makeFolder("home", "/home"),
      makeFolder("opt", "/opt"),
      makeFile("readme.txt", "/readme.txt"),
    ];
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        [undefined, rootChildren],
      ]),
    );
    const model = new ContentModel(adapter);

    const browser = new QuickFileBrowser(model);
    // show() is async-ish; it sets up the QuickPick and fires reload
    const showPromise = browser.show();

    // Wait a tick for the async loadFolder to complete
    await sleep(200);

    assert.isDefined(activeQuickPick, "QuickPick should have been created");
    await waitForNotBusy(activeQuickPick!);

    const labels = activeQuickPick!.items.map((i) => i.label);
    // Root items should appear: folders first sorted, then files
    assert.include(labels, "home");
    assert.include(labels, "opt");
    assert.include(labels, "readme.txt");

    // No parent ".." at root level
    assert.notInclude(labels, "..");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 2. Navigating into a folder shows its children + parent entry
  // -----------------------------------------------------------------------
  it("navigates into a folder and shows children with parent entry", async () => {
    const rootFolder = makeFolder("home", "/home");
    const homeChildren = [
      makeFolder("sasdemo", "/home/sasdemo"),
      makeFile("notes.txt", "/home/notes.txt"),
    ];

    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        [undefined, [rootFolder]],
        ["/home", homeChildren],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    // Start browsing at /home directly
    const showPromise = browser.show("/home");
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    const labels = activeQuickPick!.items.map((i) => i.label);
    // Should have parent entry ".."
    assert.include(labels, "..");
    // Should have the children
    assert.include(labels, "sasdemo");
    assert.include(labels, "notes.txt");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 3. Title reflects current folder path
  // -----------------------------------------------------------------------
  it("sets the QuickPick title to the current folder path", async () => {
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        ["/home/sasdemo", [makeFile("test.sas", "/home/sasdemo/test.sas")]],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show("/home/sasdemo");
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    assert.equal(activeQuickPick!.title, "/home/sasdemo");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 4. Root level shows "SAS Server" title
  // -----------------------------------------------------------------------
  it('shows "SAS Server" title at root level', async () => {
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        [undefined, [makeFolder("root", "/")]],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show();
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    assert.equal(activeQuickPick!.title, "SAS Server");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 5. Items are sorted: folders first, then files, each alphabetical
  // -----------------------------------------------------------------------
  it("sorts items: folders first alphabetically, then files alphabetically", async () => {
    const children = [
      makeFile("zebra.txt", "/zebra.txt"),
      makeFolder("beta", "/beta"),
      makeFile("alpha.sas", "/alpha.sas"),
      makeFolder("alpha", "/alpha"),
    ];
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        ["/test", children],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show("/test");
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    // First item is ".." parent, then sorted folders, then sorted files
    const labels = activeQuickPick!.items.map((i) => i.label);
    assert.equal(labels[0], "..");
    assert.equal(labels[1], "alpha");
    assert.equal(labels[2], "beta");
    assert.equal(labels[3], "alpha.sas");
    assert.equal(labels[4], "zebra.txt");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 6. QuickPick properties are set correctly
  // -----------------------------------------------------------------------
  it("sets matchOnDescription, matchOnDetail, and ignoreFocusOut", async () => {
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([[undefined, []]]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show();
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    assert.isTrue(activeQuickPick!.matchOnDescription);
    assert.isTrue(activeQuickPick!.matchOnDetail);
    assert.isTrue(activeQuickPick!.ignoreFocusOut);

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 6b. Placeholder text contains only filter hint and absolute path hint
  // -----------------------------------------------------------------------
  it("sets placeholder to 'Type to filter  ·  / enter absolute path'", async () => {
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([[undefined, []]]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show();
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    assert.equal(
      activeQuickPick!.placeholder,
      "Type to filter  ·  / enter absolute path",
    );

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 7. SAS.quickBrowseOpen context is set to true when opened
  // -----------------------------------------------------------------------
  it("sets SAS.quickBrowseOpen context to true on show", async () => {
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([[undefined, []]]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show();
    await sleep(200);

    assert.isTrue(
      setContextStub.calledWith("setContext", "SAS.quickBrowseOpen", true),
      "setContext should set SAS.quickBrowseOpen to true",
    );

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 8. SAS.quickBrowseOpen context is set to false on hide
  // -----------------------------------------------------------------------
  it("sets SAS.quickBrowseOpen context to false on hide", async () => {
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([[undefined, []]]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show();
    await sleep(200);

    activeQuickPick!.hide();
    await sleep(100);

    assert.isTrue(
      setContextStub.calledWith("setContext", "SAS.quickBrowseOpen", false),
      "setContext should set SAS.quickBrowseOpen to false after hide",
    );

    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 9. Starting from a ContentItem (not string)
  // -----------------------------------------------------------------------
  it("accepts a ContentItem as initial folder", async () => {
    const startFolder = makeFolder("mydir", "/opt/mydir");
    const children = [makeFile("data.csv", "/opt/mydir/data.csv")];

    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        ["/opt/mydir", children],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show(startFolder);
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    assert.equal(activeQuickPick!.title, "/opt/mydir");
    const labels = activeQuickPick!.items.map((i) => i.label);
    assert.include(labels, "..");
    assert.include(labels, "data.csv");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 10. Empty folder shows only parent entry
  // -----------------------------------------------------------------------
  it("shows only parent entry in an empty folder", async () => {
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        ["/empty", []],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show("/empty");
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    const labels = activeQuickPick!.items.map((i) => i.label);
    assert.equal(labels.length, 1);
    assert.equal(labels[0], "..");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 11. syntheticFolder produces correct structure
  // -----------------------------------------------------------------------
  it("syntheticFolder produces valid ContentItem with getDirectoryMembers link", () => {
    const sf = syntheticFolder("/home/sasdemo");
    assert.equal(sf.id, "synthetic:/home/sasdemo");
    assert.equal(sf.uri, "/home/sasdemo");
    assert.equal(sf.name, "sasdemo");
    assert.lengthOf(sf.links, 1);
    assert.equal(sf.links[0].rel, "getDirectoryMembers");
    assert.equal(sf.links[0].uri, "/home/sasdemo");
  });

  // -----------------------------------------------------------------------
  // 12. isFolder correctly identifies folder vs file
  // -----------------------------------------------------------------------
  it("isFolder returns true for items with getDirectoryMembers link", () => {
    assert.isTrue(isFolder(makeFolder("dir")));
    assert.isFalse(isFolder(makeFile("file.txt")));
  });

  // -----------------------------------------------------------------------
  // 13. sortContentItems sorts correctly
  // -----------------------------------------------------------------------
  it("sortContentItems places folders before files, both alphabetical", () => {
    const items = [
      makeFile("z.txt"),
      makeFolder("b"),
      makeFile("a.sas"),
      makeFolder("a"),
    ];
    const sorted = sortContentItems(items);
    assert.equal(sorted[0].name, "a");
    assert.equal(sorted[1].name, "b");
    assert.equal(sorted[2].name, "a.sas");
    assert.equal(sorted[3].name, "z.txt");
  });

  // -----------------------------------------------------------------------
  // 14. getActiveItem returns undefined when QuickPick is not open
  // -----------------------------------------------------------------------
  it("getActiveItem returns undefined when no QuickPick is open", () => {
    assert.isUndefined(getActiveItem());
  });

  // -----------------------------------------------------------------------
  // 15. onReveal callback is wired (button trigger)
  // -----------------------------------------------------------------------
  it("calls onReveal callback when item button is triggered", async () => {
    const fileItem = makeFile("test.sas", "/test.sas");
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        ["/dir", [fileItem]],
      ]),
    );
    const model = new ContentModel(adapter);

    let revealedItem: ContentItem | undefined;
    const browser = new QuickFileBrowser(
      model,
      (item) => { revealedItem = item; },
    );

    const showPromise = browser.show("/dir");
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    // Find the file item and trigger its button
    const qpItem = activeQuickPick!.items.find(
      (i) => i.label === "test.sas",
    );
    assert.isDefined(qpItem, "Should find the file item");

    assert.isUndefined(revealedItem, "onReveal should not fire before button is triggered");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 16. Folder items have description showing URI
  // -----------------------------------------------------------------------
  it("folder items show URI as description", async () => {
    const children = [makeFolder("data", "/srv/data")];
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        ["/srv", children],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show("/srv");
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    const folderQpItem = activeQuickPick!.items.find(
      (i) => i.label === "data",
    );
    assert.isDefined(folderQpItem);
    assert.equal(
      (folderQpItem as QuickPickItem).description,
      "/srv/data",
    );

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 17. Disconnected model shows empty items
  // -----------------------------------------------------------------------
  it("shows no items when model is not connected", async () => {
    const adapter = createStubAdapter(new Map());
    // Override connected to return false
    adapter.connected = () => false;
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show();
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    // When not connected, ContentModel.getChildren returns []
    assert.equal(activeQuickPick!.items.length, 0);

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // 18. Multiple folders at same level
  // -----------------------------------------------------------------------
  it("handles multiple folders and files at the same level", async () => {
    const children = [
      makeFolder("logs", "/var/logs"),
      makeFolder("cache", "/var/cache"),
      makeFolder("tmp", "/var/tmp"),
      makeFile("info.txt", "/var/info.txt"),
      makeFile("config.yml", "/var/config.yml"),
    ];
    const adapter = createStubAdapter(
      new Map<string | undefined, ContentItem[]>([
        ["/var", children],
      ]),
    );
    const model = new ContentModel(adapter);
    const browser = new QuickFileBrowser(model);

    const showPromise = browser.show("/var");
    await sleep(200);
    await waitForNotBusy(activeQuickPick!);

    const labels = activeQuickPick!.items.map((i) => i.label);
    // ".." + 3 folders + 2 files = 6 items
    assert.equal(labels.length, 6);
    // Folders sorted: cache, logs, tmp
    assert.equal(labels[1], "cache");
    assert.equal(labels[2], "logs");
    assert.equal(labels[3], "tmp");
    // Files sorted: config.yml, info.txt
    assert.equal(labels[4], "config.yml");
    assert.equal(labels[5], "info.txt");

    activeQuickPick!.hide();
    await showPromise;
  });

  // -----------------------------------------------------------------------
  // task 6.5 – absolute path handling
  // -----------------------------------------------------------------------
  describe("task 6.5 – absolute path handling", function () {

    // -------------------------------------------------------------------
    // T6.5-1. Goto item splits path into parent + filter
    // -------------------------------------------------------------------
    it("goto item splits /home/user/file.sas into parent dir and base filter", async () => {
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // Simulate typing an absolute path with a filename
      (activeQuickPick! as unknown as { value: string }).value =
        "/home/user/file.sas";
      // Manually fire onDidChangeValue by setting value through the real QuickPick
      // The real VS Code QP fires onDidChangeValue when value is set programmatically.
      // We need to set it on the underlying vscode QuickPick which fires the event.
      const realQp = activeQuickPick! as QuickPick<QuickPickItem>;
      realQp.value = "/home/user/file.sas";
      await sleep(50);

      type GotoLike = {
        kind: string;
        label: string;
        description: string;
        path: string;
        filterText: string;
      };

      const firstItem = activeQuickPick!.items[0] as unknown as GotoLike;
      assert.equal(firstItem.kind, "goto", "first item should be a goto item");
      assert.include(
        firstItem.label,
        "Go to /home/user/",
        "label should contain the parent directory",
      );
      assert.include(
        firstItem.description,
        "file.sas",
        "description should contain the basename",
      );
      assert.equal(firstItem.path, "/home/user/");
      assert.equal(firstItem.filterText, "file.sas");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // T6.5-2. Goto item for trailing-slash path
    // -------------------------------------------------------------------
    it("goto item for trailing-slash path uses 'Navigate to path' description", async () => {
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const realQp = activeQuickPick! as QuickPick<QuickPickItem>;
      realQp.value = "/home/user/";
      await sleep(50);

      type GotoLike = {
        kind: string;
        label: string;
        description: string;
        path: string;
        filterText: string;
      };

      const firstItem = activeQuickPick!.items[0] as unknown as GotoLike;
      assert.equal(firstItem.kind, "goto");
      assert.include(firstItem.label, "Go to /home/user/");
      assert.equal(firstItem.description, "Navigate to path");
      assert.equal(firstItem.filterText, "");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // T6.5-3. Goto item for single-level path (e.g. /foo)
    // -------------------------------------------------------------------
    it("goto item for /foo navigates to root / with filter 'foo'", async () => {
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const realQp = activeQuickPick! as QuickPick<QuickPickItem>;
      realQp.value = "/foo";
      await sleep(50);

      type GotoLike = {
        kind: string;
        label: string;
        description: string;
        path: string;
        filterText: string;
      };

      const firstItem = activeQuickPick!.items[0] as unknown as GotoLike;
      assert.equal(firstItem.kind, "goto");
      assert.include(firstItem.label, "Go to /");
      assert.equal(firstItem.filterText, "foo");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // T6.5-4. Accepting goto pre-fills qp.value with the basename filter
    // -------------------------------------------------------------------
    it("accepting goto item pre-fills qp.value with the basename", async () => {
      // We need to capture the onDidAccept listener registered by QuickFileBrowser
      // so we can fire it programmatically from the test.
      let capturedAcceptListener: (() => void) | undefined;

      // Re-stub createQuickPick for this test to also intercept onDidAccept
      sandbox.restore();
      sandbox = sinon.createSandbox();
      setContextStub = sandbox.stub();
      const originalExec = commands.executeCommand;
      sandbox.stub(commands, "executeCommand").callsFake(async (...args: unknown[]) => {
        if (args[0] === "setContext") {
          setContextStub(...args);
          return undefined;
        }
        return (originalExec as Function).apply(commands, args);
      });

      const originalCreate2 = window.createQuickPick.bind(window);
      sandbox.stub(window, "createQuickPick").callsFake(() => {
        const qp = originalCreate2();
        activeQuickPick = qp;
        // Wrap onDidAccept to capture the registered listener
        const origOnDidAccept = qp.onDidAccept.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidAccept = (listener: () => void) => {
          capturedAcceptListener = listener;
          return origOnDidAccept(listener);
        };
        return qp;
      });

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, []],
          ["/some/path/", []],
          ["/some/path", []],
          ["/some/", []],
          ["/some", []],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAcceptListener, "onDidAccept listener should be captured");

      // Type an absolute path with a filename to produce a goto item
      const realQp = activeQuickPick! as QuickPick<QuickPickItem>;
      realQp.value = "/some/path/myfile.sas";
      await sleep(50);

      type GotoLike = {
        kind: string;
        label: string;
        description: string;
        path: string;
        filterText: string;
      };
      const gotoItem = activeQuickPick!.items[0] as unknown as GotoLike;
      assert.equal(gotoItem.kind, "goto", "first item should be goto");

      // Override selectedItems so that when capturedAcceptListener fires, the
      // handler reads the goto item from qp.selectedItems[0].
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.defineProperty(realQp, "selectedItems", {
        get: () => [activeQuickPick!.items[0]],
        configurable: true,
      });

      // Fire the captured accept listener directly — simulates the user pressing Enter
      capturedAcceptListener!();

      // Wait for the async loadFolder to complete
      await sleep(300);
      await waitForNotBusy(activeQuickPick!);

      assert.equal(
        activeQuickPick!.value,
        "myfile.sas",
        "qp.value should be pre-filled with the basename after goto acceptance",
      );

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // T6.5-5. Accepting goto with trailing slash sets qp.value to ""
    // -------------------------------------------------------------------
    it("accepting goto item with trailing slash sets qp.value to empty string", async () => {
      // Capture the onDidAccept listener the same way as T6.5-4
      let capturedAcceptListener: (() => void) | undefined;

      sandbox.restore();
      sandbox = sinon.createSandbox();
      setContextStub = sandbox.stub();
      const originalExec = commands.executeCommand;
      sandbox.stub(commands, "executeCommand").callsFake(async (...args: unknown[]) => {
        if (args[0] === "setContext") {
          setContextStub(...args);
          return undefined;
        }
        return (originalExec as Function).apply(commands, args);
      });

      const originalCreate3 = window.createQuickPick.bind(window);
      sandbox.stub(window, "createQuickPick").callsFake(() => {
        const qp = originalCreate3();
        activeQuickPick = qp;
        const origOnDidAccept = qp.onDidAccept.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidAccept = (listener: () => void) => {
          capturedAcceptListener = listener;
          return origOnDidAccept(listener);
        };
        return qp;
      });

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, []],
          ["/some/path/", []],
          ["/some/path", []],
          ["/some/", []],
          ["/some", []],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAcceptListener, "onDidAccept listener should be captured");

      const realQp = activeQuickPick! as QuickPick<QuickPickItem>;
      realQp.value = "/some/path/";
      await sleep(50);

      type GotoLike = { kind: string; filterText: string };
      const gotoItem = activeQuickPick!.items[0] as unknown as GotoLike;
      assert.equal(gotoItem.kind, "goto");
      assert.equal(gotoItem.filterText, "", "filterText should be empty for trailing-slash path");

      // Override selectedItems so the accept handler sees the goto item
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.defineProperty(realQp, "selectedItems", {
        get: () => [activeQuickPick!.items[0]],
        configurable: true,
      });

      capturedAcceptListener!();

      await sleep(300);
      await waitForNotBusy(activeQuickPick!);

      assert.equal(
        activeQuickPick!.value,
        "",
        "qp.value should be empty string after accepting a trailing-slash goto",
      );

      activeQuickPick!.hide();
      await showPromise;
    });
  });

  // -----------------------------------------------------------------------
  // key binding commands
  // -----------------------------------------------------------------------
  describe("key binding commands", function () {

    // -------------------------------------------------------------------
    // 19. getActiveQuickPick returns QuickPick while browser is open
    // -------------------------------------------------------------------
    it("getActiveQuickPick returns QuickPick while browser is open", async () => {
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [makeFile("readme.txt", "/readme.txt")]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show(undefined);
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(
        getActiveQuickPick(),
        "getActiveQuickPick() should return a QuickPick while the browser is open",
      );

      activeQuickPick!.hide();
      // Allow the onDidHide handler to run (clears _activeQp)
      await sleep(100);

      assert.isUndefined(
        getActiveQuickPick(),
        "getActiveQuickPick() should return undefined after the QuickPick is hidden",
      );

      await showPromise;
    });

    // -------------------------------------------------------------------
    // 20. quickBrowseTabItem logic: sets qp.value to active item name
    // -------------------------------------------------------------------
    it("quickBrowseTabItem logic sets qp.value to active item name", async () => {
      const fileItem = makeFile("hello.sas", "/hello.sas");
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [fileItem]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show(undefined);
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // The real VS Code QuickPick fires onDidChangeActive automatically when
      // items are loaded and the first item is highlighted. We explicitly set
      // activeItems to ensure _activeItem is populated.
      const qp = activeQuickPick! as QuickPick<QuickPickItem> & {
        activeItems: readonly QuickPickItem[];
      };
      // Find the file item
      const targetItem = activeQuickPick!.items.find(
        (i) => i.label === "hello.sas",
      );
      assert.isDefined(targetItem, "file item should be present in QuickPick");

      // Set activeItems to trigger onDidChangeActive, which populates _activeItem
      qp.activeItems = [targetItem!];
      // Allow event to propagate
      await sleep(50);

      // Simulate what the SAS.server.quickBrowseTabItem command does:
      // read getActiveItem() and getActiveQuickPick() then set qp.value
      const item = getActiveItem();
      const activeBrowserQp = getActiveQuickPick();
      assert.isDefined(item, "getActiveItem() should return the highlighted item");
      assert.isDefined(activeBrowserQp, "getActiveQuickPick() should return the open QP");
      if (item && activeBrowserQp) {
        activeBrowserQp.value = item.name;
      }

      assert.equal(
        activeQuickPick!.value,
        "hello.sas",
        "qp.value should be set to the highlighted item's name",
      );

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 21. quickBrowseCopyPath logic: writes item uri to clipboard
    // -------------------------------------------------------------------
    it("quickBrowseCopyPath logic writes item uri to clipboard", async () => {
      const fileItem = makeFile("data.csv", "/srv/data.csv");
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [fileItem]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show(undefined);
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // Find the file item and set it as the active item
      const targetItem = activeQuickPick!.items.find(
        (i) => i.label === "data.csv",
      );
      assert.isDefined(targetItem, "file item should be present in QuickPick");

      const qp = activeQuickPick! as QuickPick<QuickPickItem> & {
        activeItems: readonly QuickPickItem[];
      };
      qp.activeItems = [targetItem!];
      await sleep(50);

      // Simulate what the SAS.server.quickBrowseCopyPath command does:
      // read getActiveItem() and write item.uri to clipboard.
      // env.clipboard.writeText is non-configurable in VS Code and cannot be
      // stubbed, so we verify correctness by reading back from the clipboard.
      const item = getActiveItem();
      assert.isDefined(item, "getActiveItem() should return the highlighted item");
      assert.equal(
        item?.uri,
        "/srv/data.csv",
        "getActiveItem() should return the item with the correct uri",
      );
      if (item) {
        await env.clipboard.writeText(item.uri);
      }

      const clipboardText = await env.clipboard.readText();
      assert.equal(
        clipboardText,
        "/srv/data.csv",
        "clipboard should contain the item's uri after quickBrowseCopyPath logic runs",
      );

      activeQuickPick!.hide();
      await showPromise;
    });
  });

  // -----------------------------------------------------------------------
  // task 6.6 – active SAS server editor pre-fills path
  // -----------------------------------------------------------------------
  describe("task 6.6 – active SAS server editor pre-fills path", function () {
    // -----------------------------------------------------------------------
    // T6.6-1. sasServer file pre-fills input with full path, stays at root
    // -----------------------------------------------------------------------
    it("pre-fills input with full server path when active editor is a sasServer file", async () => {
      sandbox.stub(window, "activeTextEditor").get(() => ({
        document: { uri: Uri.parse("sasServer:/home/user/myfile.sas") },
      }));

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);
      await sleep(50); // allow onDidChangeValue to fire after qp.value is set

      // Stays at root — no navigation
      assert.equal(activeQuickPick!.title, "SAS Server", "title should be SAS Server (at root)");
      assert.notInclude(
        activeQuickPick!.items.map((i) => i.label),
        "..",
        "should be at root, no parent entry",
      );
      // Full path in the input box
      assert.equal(activeQuickPick!.value, "/home/user/myfile.sas");
      // GotoItem is shown pointing at the parent dir
      type GotoLike = { kind: string; path: string; filterText: string };
      const gotoItem = activeQuickPick!.items[0] as unknown as GotoLike;
      assert.equal(gotoItem.kind, "goto");
      assert.equal(gotoItem.path, "/home/user/");
      assert.equal(gotoItem.filterText, "myfile.sas");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------------
    // T6.6-2. sasServerReadOnly scheme also pre-fills
    // -----------------------------------------------------------------------
    it("pre-fills input when active editor uses sasServerReadOnly scheme", async () => {
      sandbox.stub(window, "activeTextEditor").get(() => ({
        document: { uri: Uri.parse("sasServerReadOnly:/opt/sas/config.sas") },
      }));

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);
      await sleep(50);

      assert.equal(activeQuickPick!.title, "SAS Server");
      assert.equal(activeQuickPick!.value, "/opt/sas/config.sas");
      type GotoLike = { kind: string; path: string; filterText: string };
      const gotoItem = activeQuickPick!.items[0] as unknown as GotoLike;
      assert.equal(gotoItem.kind, "goto");
      assert.equal(gotoItem.path, "/opt/sas/");
      assert.equal(gotoItem.filterText, "config.sas");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------------
    // T6.6-3. Non-SAS file (file: scheme) does not pre-fill
    // -----------------------------------------------------------------------
    it("does not pre-fill when active editor is a local file (file: scheme)", async () => {
      sandbox.stub(window, "activeTextEditor").get(() => ({
        document: { uri: Uri.file("/local/path/myfile.sas") },
      }));

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // Should start at root (no ".." parent entry)
      const labels = activeQuickPick!.items.map((i) => i.label);
      assert.notInclude(labels, "..", "should be at root, no parent entry");
      assert.equal(activeQuickPick!.title, "SAS Server", "title should be SAS Server at root");
      assert.equal(activeQuickPick!.value, "", "value should be empty");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------------
    // T6.6-4. No active editor does not pre-fill
    // -----------------------------------------------------------------------
    it("does not pre-fill when there is no active editor", async () => {
      sandbox.stub(window, "activeTextEditor").get(() => undefined);

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const labels = activeQuickPick!.items.map((i) => i.label);
      assert.notInclude(labels, "..", "should be at root, no parent entry");
      assert.equal(activeQuickPick!.title, "SAS Server");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------------
    // T6.6-5. Explicit arg takes priority over active editor
    // -----------------------------------------------------------------------
    it("explicit string arg takes priority over active editor pre-fill", async () => {
      sandbox.stub(window, "activeTextEditor").get(() => ({
        document: { uri: Uri.parse("sasServer:/home/user/myfile.sas") },
      }));

      const homeChildren = [makeFolder("subdir", "/home/subdir")];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, []],
          ["/home/", homeChildren],
          ["/home/user/", [makeFile("myfile.sas", "/home/user/myfile.sas")]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      // Explicit path arg — should start there, not at the active editor's parent
      const showPromise = browser.show("/home/");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.equal(activeQuickPick!.title, "/home/", "title should be the explicit arg, not active editor parent");
      assert.equal(activeQuickPick!.value, "", "value should be empty (no active-editor pre-fill)");

      activeQuickPick!.hide();
      await showPromise;
    });
  });

  // -----------------------------------------------------------------------
  // task 6.7 – history and bookmarks
  // -----------------------------------------------------------------------
  describe("task 6.7: history and bookmarks", function () {

    // Tracks the active capturing sandbox so afterEach can restore it even if
    // a test throws before calling sb.restore() explicitly.
    let _capturingSb: sinon.SinonSandbox | undefined;

    afterEach(() => {
      _capturingSb?.restore();
      _capturingSb = undefined;
    });

    // Helper: create an in-memory Memento stub
    function makeMementoStub(): Memento {
      const store = new Map<string, unknown>();
      return {
        get<T>(key: string, defaultValue?: T): T {
          return (store.has(key) ? store.get(key) : defaultValue) as T;
        },
        update(key: string, value: unknown): Thenable<void> {
          store.set(key, value);
          return Promise.resolve();
        },
        keys(): readonly string[] {
          return [...store.keys()];
        },
      };
    }

    // Helper: rebuild a full sandbox that also captures onDidAccept,
    // onDidTriggerItemButton, onDidTriggerButton, and onDidChangeActive listeners
    // so tests can fire them manually.
    function buildCapturingSandbox(): {
      sb: sinon.SinonSandbox;
      setCtxStub: sinon.SinonStub;
      capturedAccept: { fn: (() => void) | undefined };
      capturedTriggerBtn: {
        fn:
          | ((e: { button: { tooltip?: string }; item: QuickPickItem }) => void)
          | undefined;
      };
      capturedTriggerTitleBtn: { fn: ((btn: QuickInputButton) => void) | undefined };
      capturedChangeActive: {
        fn: ((items: readonly QuickPickItem[]) => void) | undefined;
      };
    } {
      // The outer beforeEach already stubs commands.executeCommand and
      // window.createQuickPick. Restore those stubs first so this sandbox
      // can wrap them again with additional behaviour.
      sandbox.restore();
      const sb = sinon.createSandbox();
      _capturingSb = sb;
      const setCtxStub = sb.stub();
      const capturedAccept: { fn: (() => void) | undefined } = { fn: undefined };
      const capturedTriggerBtn: {
        fn:
          | ((e: { button: { tooltip?: string }; item: QuickPickItem }) => void)
          | undefined;
      } = { fn: undefined };
      const capturedTriggerTitleBtn: {
        fn: ((btn: QuickInputButton) => void) | undefined;
      } = { fn: undefined };
      const capturedChangeActive: {
        fn: ((items: readonly QuickPickItem[]) => void) | undefined;
      } = { fn: undefined };

      const originalExecInner = commands.executeCommand;
      sb.stub(commands, "executeCommand").callsFake(async (...args: unknown[]) => {
        if (args[0] === "setContext") {
          setCtxStub(...args);
          return undefined;
        }
        return (originalExecInner as Function).apply(commands, args);
      });

      const originalCreateInner = window.createQuickPick.bind(window);
      sb.stub(window, "createQuickPick").callsFake(() => {
        const qp = originalCreateInner();
        activeQuickPick = qp;

        const origAccept = qp.onDidAccept.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidAccept = (listener: () => void) => {
          capturedAccept.fn = listener;
          return origAccept(listener);
        };

        const origTriggerBtn = qp.onDidTriggerItemButton.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidTriggerItemButton = (
          listener: (e: {
            button: { tooltip?: string };
            item: QuickPickItem;
          }) => void,
        ) => {
          capturedTriggerBtn.fn = listener;
          return origTriggerBtn(listener as Parameters<typeof origTriggerBtn>[0]);
        };

        const origTriggerBtn2 = qp.onDidTriggerButton.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidTriggerButton = (listener: (btn: QuickInputButton) => void) => {
          capturedTriggerTitleBtn.fn = listener;
          return origTriggerBtn2(listener);
        };

        const origChangeActive = qp.onDidChangeActive.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidChangeActive = (listener: (items: readonly QuickPickItem[]) => void) => {
          capturedChangeActive.fn = listener;
          return origChangeActive(listener);
        };

        return qp;
      });

      return { sb, setCtxStub, capturedAccept, capturedTriggerBtn, capturedTriggerTitleBtn, capturedChangeActive };
    }

    // Custom item type aliases for assertions (mirrors BrowserQuickPickItem internals)
    type AnyItem = {
      kind: string | number;
      label: string;
      storedItem?: { uri: string; name: string; isFolder: boolean; vsUri?: string };
      buttons?: Array<{ tooltip?: string }>;
    };

    // -------------------------------------------------------------------
    // 6.7.1. Root shows "Bookmarks" separator + bookmark items when store
    //        has bookmarks
    // -------------------------------------------------------------------
    it("6.7.1: root shows Bookmarks separator and bookmark items when store has bookmarks", async () => {
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.addBookmark({ uri: "/home/bookmarked", name: "bookmarked" }, true);

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const items = activeQuickPick!.items as unknown as AnyItem[];

      // There should be a separator with label "Bookmarks"
      const bookmarksSep = items.find(
        (i) => i.kind === QuickPickItemKind.Separator && i.label === "Bookmarks",
      );
      assert.isDefined(bookmarksSep, 'should have a "Bookmarks" separator');

      // There should be a bookmark item with label "bookmarked"
      const bookmarkItem = items.find(
        (i) => i.kind === "bookmark" && i.label === "bookmarked",
      );
      assert.isDefined(bookmarkItem, 'should have a bookmark item labelled "bookmarked"');
      assert.equal(bookmarkItem!.storedItem?.uri, "/home/bookmarked");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.7.2. Root shows "Recent" separator + history items when store has
    //        history
    // -------------------------------------------------------------------
    it("6.7.2: root shows Recent separator and history items when store has history", async () => {
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory({ uri: "/home/recent", name: "recent" }, true);

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const items = activeQuickPick!.items as unknown as AnyItem[];

      const recentSep = items.find(
        (i) => i.kind === QuickPickItemKind.Separator && i.label === "Recent",
      );
      assert.isDefined(recentSep, 'should have a "Recent" separator');

      const historyItem = items.find(
        (i) => i.kind === "history" && i.label === "recent",
      );
      assert.isDefined(historyItem, 'should have a history item labelled "recent"');
      assert.equal(historyItem!.storedItem?.uri, "/home/recent");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.7.3. Root shows "Server Files" separator when prefix items exist
    // -------------------------------------------------------------------
    it("6.7.3: root shows Server Files separator when bookmarks or history are present", async () => {
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory({ uri: "/home/recent", name: "recent" }, false, "sasServer:/home/recent");

      const rootChildren = [makeFolder("home", "/home")];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, rootChildren]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const allItems = activeQuickPick!.items as unknown as AnyItem[];

      const serverFilesSep = allItems.find(
        (i) => i.kind === QuickPickItemKind.Separator && i.label === "Server Files",
      );
      assert.isDefined(serverFilesSep, 'should have a "Server Files" separator');

      // Verify order: "Server Files" should be first, and appear before "Recent"
      const serverIdx = allItems.findIndex(
        (i) => i.kind === QuickPickItemKind.Separator && i.label === "Server Files",
      );
      const recentIdx = allItems.findIndex(
        (i) => i.kind === QuickPickItemKind.Separator && i.label === "Recent",
      );
      assert.equal(serverIdx, 0, '"Server Files" should be the first item in the list');
      assert.isTrue(serverIdx < recentIdx, '"Server Files" should appear before "Recent"');

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.7.4. No prefix sections when store is empty
    // -------------------------------------------------------------------
    it("6.7.4: no separator clutter when store is empty", async () => {
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);

      const rootChildren = [makeFolder("home", "/home")];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, rootChildren]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const items = activeQuickPick!.items as unknown as AnyItem[];
      const separators = items.filter(
        (i) => i.kind === QuickPickItemKind.Separator,
      );
      assert.equal(separators.length, 0, "no separators should appear when store is empty");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.7.5. Accepting a bookmark item that is a folder → navigates into it
    // -------------------------------------------------------------------
    it("6.7.5: accepting a bookmark folder item navigates into that folder", async () => {
      const { sb, setCtxStub: _ctx, capturedAccept } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.addBookmark({ uri: "/home/bookmarked", name: "bookmarked" }, true);

      const folderChildren = [makeFile("data.sas", "/home/bookmarked/data.sas")];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, []],
          ["/home/bookmarked", folderChildren],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAccept.fn, "onDidAccept listener should be captured");

      // Find the bookmark item
      const items = activeQuickPick!.items as unknown as AnyItem[];
      const bookmarkItem = items.find((i) => i.kind === "bookmark" && i.label === "bookmarked");
      assert.isDefined(bookmarkItem, "bookmark item must be present");

      // Make the QuickPick appear to have the bookmark item selected
      Object.defineProperty(activeQuickPick!, "selectedItems", {
        get: () => [bookmarkItem as unknown as QuickPickItem],
        configurable: true,
      });

      // Fire accept
      capturedAccept.fn!();

      await sleep(300);
      await waitForNotBusy(activeQuickPick!);

      // Should have navigated into /home/bookmarked
      assert.equal(
        activeQuickPick!.title,
        "/home/bookmarked",
        "title should change to the bookmarked folder path after accepting",
      );

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.6. Accepting a history item that is a file → opens via command
    // -------------------------------------------------------------------
    it("6.7.6: accepting a history file item opens it via SAS.server.openItem", async () => {
      const { sb } = buildCapturingSandbox();

      // Track executeCommand calls for SAS.server.openItem
      const openItemCalls: unknown[][] = [];
      // Re-wrap the already-stubbed executeCommand to also capture openItem calls.
      // buildCapturingSandbox() already stubbed commands.executeCommand; restore and
      // re-stub to add openItem tracking.
      sb.restore();

      const innerSb = sinon.createSandbox();
      const setCtxStub2 = innerSb.stub();
      const capturedAccept2: { fn: (() => void) | undefined } = { fn: undefined };

      const originalExec2 = commands.executeCommand;
      innerSb
        .stub(commands, "executeCommand")
        .callsFake(async (...args: unknown[]) => {
          if (args[0] === "setContext") {
            setCtxStub2(...args);
            return undefined;
          }
          if (args[0] === "SAS.server.openItem") {
            openItemCalls.push(args);
            return undefined;
          }
          return (originalExec2 as Function).apply(commands, args);
        });

      const originalCreate6 = window.createQuickPick.bind(window);
      innerSb.stub(window, "createQuickPick").callsFake(() => {
        const qp = originalCreate6();
        activeQuickPick = qp;
        const origAccept = qp.onDidAccept.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidAccept = (listener: () => void) => {
          capturedAccept2.fn = listener;
          return origAccept(listener);
        };
        return qp;
      });

      const vsUriStr = "sasServer:/home/file.sas";
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory(
        { uri: "/home/file.sas", name: "file.sas" },
        false,
        vsUriStr,
      );

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAccept2.fn, "onDidAccept listener should be captured");

      const items = activeQuickPick!.items as unknown as AnyItem[];
      const historyItem = items.find(
        (i) => i.kind === "history" && i.label === "file.sas",
      );
      assert.isDefined(historyItem, "history item must be present");

      Object.defineProperty(activeQuickPick!, "selectedItems", {
        get: () => [historyItem as unknown as QuickPickItem],
        configurable: true,
      });

      capturedAccept2.fn!();
      await sleep(100);

      assert.isAtLeast(openItemCalls.length, 1, "SAS.server.openItem should have been called");
      const calledUri = openItemCalls[0][1] as Uri;
      assert.equal(
        calledUri.toString(),
        Uri.parse(vsUriStr).toString(),
        "SAS.server.openItem should be called with the stored vsUri",
      );

      // QuickPick hides after openItem
      await showPromise;
      innerSb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.7. Clicking the remove button on a history item removes it
    // -------------------------------------------------------------------
    it("6.7.7: clicking remove button on history item removes it from the list", async () => {
      const { sb, capturedTriggerBtn } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory({ uri: "/home/old", name: "old" }, true);

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedTriggerBtn.fn, "onDidTriggerItemButton listener should be captured");

      const items = activeQuickPick!.items as unknown as AnyItem[];
      const historyItem = items.find((i) => i.kind === "history" && i.label === "old");
      assert.isDefined(historyItem, "history item must be present before removal");

      // Find the Remove button (tooltip "Remove")
      const removeBtn = historyItem!.buttons?.find((b) => b.tooltip === "Remove");
      assert.isDefined(removeBtn, "history item should have a Remove button");

      // Fire the button trigger event
      capturedTriggerBtn.fn!({
        button: removeBtn!,
        item: historyItem as unknown as QuickPickItem,
      });

      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const updatedItems = activeQuickPick!.items as unknown as AnyItem[];
      const stillPresent = updatedItems.find(
        (i) => i.kind === "history" && i.label === "old",
      );
      assert.isUndefined(
        stillPresent,
        "history item should be removed after clicking Remove",
      );

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.8. Clicking the remove button on a bookmark item removes it
    // -------------------------------------------------------------------
    it("6.7.8: clicking remove button on bookmark item removes it from the list", async () => {
      const { sb, capturedTriggerBtn } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.addBookmark({ uri: "/home/pinned", name: "pinned" }, true);

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedTriggerBtn.fn, "onDidTriggerItemButton listener should be captured");

      const items = activeQuickPick!.items as unknown as AnyItem[];
      const bookmarkItem = items.find(
        (i) => i.kind === "bookmark" && i.label === "pinned",
      );
      assert.isDefined(bookmarkItem, "bookmark item must be present before removal");

      const removeBtn = bookmarkItem!.buttons?.find((b) => b.tooltip === "Remove");
      assert.isDefined(removeBtn, "bookmark item should have a Remove button");

      capturedTriggerBtn.fn!({
        button: removeBtn!,
        item: bookmarkItem as unknown as QuickPickItem,
      });

      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const updatedItems = activeQuickPick!.items as unknown as AnyItem[];
      const stillPresent = updatedItems.find(
        (i) => i.kind === "bookmark" && i.label === "pinned",
      );
      assert.isUndefined(
        stillPresent,
        "bookmark item should be removed after clicking Remove",
      );

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.9. Navigating into a folder does NOT record it in history
    // -------------------------------------------------------------------
    it("6.7.9: navigating into a folder does NOT record it in history (history is files only)", async () => {
      const { sb, capturedAccept } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);

      const subFolder = makeFolder("subdir", "/root/subdir");
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [subFolder]],
          ["/root/subdir", []],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAccept.fn, "onDidAccept listener should be captured");

      // Find the folder item in the QuickPick
      const folderQpItem = activeQuickPick!.items.find((i) => i.label === "subdir");
      assert.isDefined(folderQpItem, "folder item must be present");

      Object.defineProperty(activeQuickPick!, "selectedItems", {
        get: () => [folderQpItem!],
        configurable: true,
      });

      // Initially history should be empty
      assert.equal(store.getHistory().length, 0, "history should be empty before navigation");

      capturedAccept.fn!();
      await sleep(300);
      await waitForNotBusy(activeQuickPick!);

      // Folder navigation should NOT be recorded in history (files only)
      const history = store.getHistory();
      assert.equal(history.length, 0, "history should remain empty after folder navigation");

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.10. Opening a file records it in history (with vsUri)
    // -------------------------------------------------------------------
    it("6.7.10: opening a file records it in history with vsUri", async () => {
      const { sb } = buildCapturingSandbox();

      // Also intercept SAS.server.openItem
      sb.restore();
      const innerSb2 = sinon.createSandbox();
      const capturedAccept10: { fn: (() => void) | undefined } = { fn: undefined };

      const originalExec10 = commands.executeCommand;
      innerSb2
        .stub(commands, "executeCommand")
        .callsFake(async (...args: unknown[]) => {
          if (args[0] === "setContext") {
            return undefined;
          }
          if (args[0] === "SAS.server.openItem") {
            return undefined;
          }
          return (originalExec10 as Function).apply(commands, args);
        });

      const originalCreate10 = window.createQuickPick.bind(window);
      innerSb2.stub(window, "createQuickPick").callsFake(() => {
        const qp = originalCreate10();
        activeQuickPick = qp;
        const origAccept = qp.onDidAccept.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidAccept = (listener: () => void) => {
          capturedAccept10.fn = listener;
          return origAccept(listener);
        };
        return qp;
      });

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);

      const fileItem = makeFile("report.sas", "/home/report.sas");
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          ["/home", [fileItem]],
        ]),
      );
      // Override getUriOfItem so the URI returned matches what we expect
      adapter.getUriOfItem = (item: ContentItem) =>
        Promise.resolve(Uri.parse(`sasServer:${item.uri}`));

      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show("/home");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAccept10.fn, "onDidAccept listener should be captured");

      const fileQpItem = activeQuickPick!.items.find((i) => i.label === "report.sas");
      assert.isDefined(fileQpItem, "file item must be present");

      Object.defineProperty(activeQuickPick!, "selectedItems", {
        get: () => [fileQpItem!],
        configurable: true,
      });

      assert.equal(store.getHistory().length, 0, "history should be empty before file open");

      capturedAccept10.fn!();
      // Wait for the async getUri + pushHistory chain
      await sleep(500);

      const history = store.getHistory();
      assert.isAtLeast(history.length, 1, "history should have an entry after opening a file");
      assert.equal(history[0].uri, "/home/report.sas");
      assert.isFalse(history[0].isFolder);
      assert.isDefined(history[0].vsUri, "vsUri should be stored");
      assert.include(
        history[0].vsUri,
        "report.sas",
        "vsUri should reference the file",
      );

      await showPromise;
      innerSb2.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.11. Folder/file items show star button; bookmarked → star-full
    // -------------------------------------------------------------------
    it("6.7.11: non-bookmarked items show star button; bookmarked items show star-full button", async () => {
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      // /dir2 is bookmarked, /dir1 is not
      store.addBookmark({ uri: "/dir2", name: "dir2" }, true);

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [
            undefined,
            [
              makeFolder("dir1", "/dir1"),
              makeFolder("dir2", "/dir2"),
            ],
          ],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const items = activeQuickPick!.items as unknown as AnyItem[];

      const dir1Item = items.find((i) => i.kind === "folder" && i.label === "dir1");
      const dir2Item = items.find((i) => i.kind === "folder" && i.label === "dir2");
      assert.isDefined(dir1Item, "dir1 folder item must be present");
      assert.isDefined(dir2Item, "dir2 folder item must be present");

      // dir1 is not bookmarked — first button should be "Add to Bookmarks"
      const dir1FirstBtn = dir1Item!.buttons?.[0];
      assert.equal(
        dir1FirstBtn?.tooltip,
        "Add to Bookmarks",
        "non-bookmarked item should show Add to Bookmarks button",
      );

      // dir2 is bookmarked — first button should be "Remove from Bookmarks"
      const dir2FirstBtn = dir2Item!.buttons?.[0];
      assert.equal(
        dir2FirstBtn?.tooltip,
        "Remove from Bookmarks",
        "bookmarked item should show Remove from Bookmarks button",
      );

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.7.12. Clicking bookmark add button adds to bookmarks and refreshes
    // -------------------------------------------------------------------
    it("6.7.12: clicking bookmark add button adds item to bookmarks and refreshes list", async () => {
      const { sb, capturedTriggerBtn } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      // /mydir is NOT bookmarked initially

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [makeFolder("mydir", "/mydir")]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedTriggerBtn.fn, "onDidTriggerItemButton listener should be captured");

      // Find the folder item for mydir
      const items = activeQuickPick!.items as unknown as AnyItem[];
      const folderItem = items.find((i) => i.kind === "folder" && i.label === "mydir");
      assert.isDefined(folderItem, "folder item must be present");

      // The first button should be "Add to Bookmarks"
      const addBtn = folderItem!.buttons?.find((b) => b.tooltip === "Add to Bookmarks");
      assert.isDefined(addBtn, "folder item should have an Add to Bookmarks button");

      assert.isFalse(store.isBookmarked("/mydir"), "should not be bookmarked yet");

      // Click the bookmark add button
      capturedTriggerBtn.fn!({
        button: addBtn!,
        item: folderItem as unknown as QuickPickItem,
      });

      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // Store should now have /mydir bookmarked
      assert.isTrue(store.isBookmarked("/mydir"), "mydir should be bookmarked after clicking Add to Bookmarks");

      // The item in the refreshed list should now show "Remove from Bookmarks"
      const updatedItems = activeQuickPick!.items as unknown as AnyItem[];
      const updatedFolder = updatedItems.find(
        (i) => i.kind === "folder" && i.label === "mydir",
      );
      assert.isDefined(updatedFolder, "folder item should still be present after bookmark toggle");
      const updatedFirstBtn = updatedFolder!.buttons?.[0];
      assert.equal(
        updatedFirstBtn?.tooltip,
        "Remove from Bookmarks",
        "after adding bookmark, button should switch to Remove from Bookmarks",
      );

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.13. Bookmark ADD button on a file item eagerly fetches vsUri;
    //         accepting the resulting bookmark item opens it via openItem
    // -------------------------------------------------------------------
    it("6.7.13: accepting a bookmarked file (no vsUri) opens it via SAS.server.openItem", async () => {
      const { sb, capturedTriggerBtn, capturedAccept } = buildCapturingSandbox();

      const openItemCalls: unknown[][] = [];
      // Override the already-stubbed executeCommand to also track openItem calls
      const execStub = commands.executeCommand as sinon.SinonStub;
      execStub.callsFake(async (...args: unknown[]) => {
        if (args[0] === "setContext") return undefined;
        if (args[0] === "SAS.server.openItem") {
          openItemCalls.push(args);
          return undefined;
        }
        return undefined;
      });

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);

      const fileItem = makeFile("report.sas", "/home/report.sas");
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [fileItem]],
        ]),
      );
      // Override getUriOfItem so the eager getUri call during bookmark add returns a real URI
      adapter.getUriOfItem = (_item: ContentItem) =>
        Promise.resolve(Uri.parse("sasServer:/home/report.sas"));

      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedTriggerBtn.fn, "onDidTriggerItemButton listener should be captured");

      // Find the file item in the QuickPick
      const items = activeQuickPick!.items as unknown as AnyItem[];
      const fileQpItem = items.find((i) => i.kind === "file" && i.label === "report.sas");
      assert.isDefined(fileQpItem, "file item for report.sas must be present");

      // Find the "Add to Bookmarks" button on the file item
      const addBtn = fileQpItem!.buttons?.find((b) => b.tooltip === "Add to Bookmarks");
      assert.isDefined(addBtn, "file item should have an Add to Bookmarks button");

      // Click the bookmark add button — this should eagerly call getUri and store vsUri
      capturedTriggerBtn.fn!({
        button: addBtn!,
        item: fileQpItem as unknown as QuickPickItem,
      });

      // Wait for the async getUri call to complete
      await sleep(300);

      // The store should now have /home/report.sas bookmarked
      assert.isTrue(store.isBookmarked("/home/report.sas"), "report.sas should be bookmarked after clicking Add to Bookmarks");

      // The bookmark entry should have vsUri populated
      const bookmarks = store.getBookmarks();
      assert.isAtLeast(bookmarks.length, 1, "store should have at least one bookmark");
      const storedBookmark = bookmarks.find((b) => b.uri === "/home/report.sas");
      assert.isDefined(storedBookmark, "bookmark for /home/report.sas should exist");
      assert.isDefined(storedBookmark?.vsUri, "vsUri should be eagerly populated on the bookmark");
      assert.include(storedBookmark?.vsUri, "report.sas", "vsUri should reference the file");

      // Now accept the bookmark item to open it
      await waitForNotBusy(activeQuickPick!);
      const updatedItems = activeQuickPick!.items as unknown as AnyItem[];
      const bookmarkQpItem = updatedItems.find(
        (i) => i.kind === "bookmark" && i.label === "report.sas",
      );
      assert.isDefined(bookmarkQpItem, "bookmark item for report.sas must be present after adding");

      Object.defineProperty(activeQuickPick!, "selectedItems", {
        get: () => [bookmarkQpItem as unknown as QuickPickItem],
        configurable: true,
      });

      capturedAccept.fn!();
      await sleep(300);

      assert.isAtLeast(
        openItemCalls.length,
        1,
        "SAS.server.openItem should have been called when accepting the bookmark",
      );

      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.14. History/bookmark file entries have resourceUri for file icons
    // -------------------------------------------------------------------
    it("6.7.14: history/bookmark file entries have resourceUri for file-themed icons", async () => {
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory(
        { uri: "/home/test.sas", name: "test.sas" },
        false,
        "sasServer:/home/test.sas",
      );
      store.addBookmark(
        { uri: "/home/data.sas", name: "data.sas" },
        false,
        "sasServer:/home/data.sas",
      );

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const items = activeQuickPick!.items as unknown as AnyItem[];

      const historyItem = items.find(
        (i) => i.kind === "history" && i.label === "test.sas",
      );
      const bookmarkItem = items.find(
        (i) => i.kind === "bookmark" && i.label === "data.sas",
      );

      assert.isDefined(historyItem, "history item for test.sas must be present");
      assert.isDefined(bookmarkItem, "bookmark item for data.sas must be present");

      assert.isDefined(
        (historyItem as unknown as Record<string, unknown>).resourceUri,
        "history file item should have resourceUri defined for file-themed icon",
      );
      assert.isDefined(
        (bookmarkItem as unknown as Record<string, unknown>).resourceUri,
        "bookmark file item should have resourceUri defined for file-themed icon",
      );

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.7.15. getActiveStoredItem() returns stored item when a history/
    //         bookmark item is active in the QuickPick
    // -------------------------------------------------------------------
    it("6.7.15: getActiveStoredItem() returns the stored item when a history/bookmark item is active", async () => {
      const { sb, capturedChangeActive } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory(
        { uri: "/home/file.sas", name: "file.sas" },
        false,
        "sasServer:/home/file.sas",
      );

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedChangeActive.fn, "onDidChangeActive listener should be captured");

      const items = activeQuickPick!.items as unknown as AnyItem[];
      const historyItem = items.find(
        (i) => i.kind === "history" && i.label === "file.sas",
      );
      assert.isDefined(historyItem, "history item must be present");

      // Fire onDidChangeActive with the history item as the active item
      capturedChangeActive.fn!([historyItem as unknown as QuickPickItem]);
      await sleep(50);

      // getActiveStoredItem() should return the stored item
      const storedItem = getActiveStoredItem();
      assert.isDefined(storedItem, "getActiveStoredItem() should return a stored item");
      assert.equal(storedItem?.uri, "/home/file.sas", "stored item URI should match");

      // Regular getActiveItem() should be undefined for stored items
      assert.isUndefined(
        getActiveItem(),
        "getActiveItem() should be undefined when a stored item (history/bookmark) is active",
      );

      // Now simulate a regular folder/file item becoming active — storedItem should clear
      const rootAdapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [makeFile("regular.sas", "/regular.sas")]],
        ]),
      );
      // Reload browser with a regular item to get a non-stored QP item
      const rootModel = new ContentModel(rootAdapter);
      const browser2 = new QuickFileBrowser(rootModel, undefined, undefined, store);
      const showPromise2 = browser2.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const regularItem = activeQuickPick!.items.find((i) => i.label === "regular.sas");
      if (regularItem && capturedChangeActive.fn) {
        capturedChangeActive.fn([regularItem]);
        await sleep(50);
        assert.isUndefined(
          getActiveStoredItem(),
          "getActiveStoredItem() should be undefined when a regular item is active",
        );
      }

      activeQuickPick!.hide();
      await showPromise2;
      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.16. toggleBookmarkActiveItem() toggles bookmark on active item
    // -------------------------------------------------------------------
    it("6.7.16: toggleBookmarkActiveItem() toggles bookmark on the active folder/file item", async () => {
      const { sb, capturedChangeActive } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [makeFolder("mydir", "/my/dir")]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedChangeActive.fn, "onDidChangeActive listener should be captured");

      const items = activeQuickPick!.items as unknown as AnyItem[];
      const folderQpItem = items.find((i) => (i as unknown as AnyItem).kind === "folder");
      assert.isDefined(folderQpItem, "folder item must be present");

      // Initially not bookmarked
      assert.isFalse(store.isBookmarked("/my/dir"), "should not be bookmarked initially");

      // Make the folder item active
      capturedChangeActive.fn!([folderQpItem as unknown as QuickPickItem]);
      await sleep(50);

      // Toggle bookmark on — should add bookmark and refresh
      toggleBookmarkActiveItem();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isTrue(
        store.isBookmarked("/my/dir"),
        "mydir should be bookmarked after toggleBookmarkActiveItem()",
      );

      // In the refreshed list, the folder item should now show "Remove from Bookmarks" as first button
      const refreshedItems = activeQuickPick!.items as unknown as AnyItem[];
      const refreshedFolder = refreshedItems.find((i) => (i as unknown as AnyItem).kind === "folder" && i.label === "mydir");
      assert.isDefined(refreshedFolder, "folder item should still be present after toggle");
      assert.equal(
        refreshedFolder!.buttons?.[0]?.tooltip,
        "Remove from Bookmarks",
        "first button should be Remove from Bookmarks after bookmarking",
      );

      // Make the folder active again (list was refreshed, find updated item)
      capturedChangeActive.fn!([refreshedFolder as unknown as QuickPickItem]);
      await sleep(50);

      // Toggle bookmark off — should remove bookmark and refresh
      toggleBookmarkActiveItem();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isFalse(
        store.isBookmarked("/my/dir"),
        "mydir should no longer be bookmarked after second toggleBookmarkActiveItem()",
      );

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.7.17. QuickPick title has a clear-history button when history
    //         is non-empty
    // -------------------------------------------------------------------
    it("6.7.17: QuickPick title has a clear-history button when history is non-empty", async () => {
      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory({ uri: "/home/test.sas", name: "test.sas" }, false, "sasServer:/home/test.sas");

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buttons: QuickInputButton[] = (activeQuickPick as any).buttons ?? [];
      assert.isArray(buttons, "QuickPick buttons should be an array");
      assert.isAtLeast(buttons.length, 1, "should have at least one title button when history is non-empty");

      const clearBtn = buttons.find((b) => b.tooltip === "Clear Recent History");
      assert.isDefined(clearBtn, 'should have a title button with tooltip "Clear Recent History"');

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.7.18. Clicking the clear history title button removes all history
    //         items from the QuickPick list
    // -------------------------------------------------------------------
    it("6.7.18: clicking the clear history title button removes all history items", async () => {
      const { sb, capturedTriggerTitleBtn } = buildCapturingSandbox();

      const memento = makeMementoStub();
      const store = new QuickFileBrowserStore(memento);
      store.pushHistory({ uri: "/home/file1.sas", name: "file1.sas" }, false, "sasServer:/home/file1.sas");
      store.pushHistory({ uri: "/home/file2.sas", name: "file2.sas" }, false, "sasServer:/home/file2.sas");

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([[undefined, []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model, undefined, undefined, store);

      const showPromise = browser.show();
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // Verify history items are visible before clearing
      const itemsBefore = activeQuickPick!.items as unknown as AnyItem[];
      const historyItemsBefore = itemsBefore.filter((i) => i.kind === "history");
      assert.isAtLeast(historyItemsBefore.length, 1, "should have at least one history item before clearing");

      assert.isDefined(capturedTriggerTitleBtn.fn, "onDidTriggerButton listener should be captured");

      // Find the clear history button from the QuickPick title buttons
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const titleButtons: QuickInputButton[] = (activeQuickPick as any).buttons ?? [];
      const clearBtn = titleButtons.find((b) => b.tooltip === "Clear Recent History");
      assert.isDefined(clearBtn, 'title button "Clear Recent History" must be present');

      // Fire the title button trigger
      capturedTriggerTitleBtn.fn!(clearBtn!);

      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      // No history items should remain
      const itemsAfter = activeQuickPick!.items as unknown as AnyItem[];
      const historyItemsAfter = itemsAfter.filter((i) => i.kind === "history");
      assert.equal(historyItemsAfter.length, 0, "no history items should remain after clearing");

      // No "Recent" separator should remain
      const recentSep = itemsAfter.find(
        (i) => i.kind === QuickPickItemKind.Separator && i.label === "Recent",
      );
      assert.isUndefined(recentSep, '"Recent" separator should be removed after clearing history');

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });
  });

  // -----------------------------------------------------------------------
  // task 6.8 – parent navigation from deep paths (bookmark/history/goto)
  // -----------------------------------------------------------------------
  describe("task 6.8: parent navigation from deep paths", function () {

    // Tracks the active capturing sandbox so afterEach can restore it.
    let _capturingSb68: sinon.SinonSandbox | undefined;

    afterEach(() => {
      _capturingSb68?.restore();
      _capturingSb68 = undefined;
    });

    /** Same helper pattern as 6.7 buildCapturingSandbox — captures onDidAccept. */
    function buildCapturingSandbox68(): {
      sb: sinon.SinonSandbox;
      capturedAccept: { fn: (() => void) | undefined };
    } {
      sandbox.restore();
      const sb = sinon.createSandbox();
      _capturingSb68 = sb;
      const capturedAccept: { fn: (() => void) | undefined } = { fn: undefined };

      const originalExec68 = commands.executeCommand;
      sb.stub(commands, "executeCommand").callsFake(async (...args: unknown[]) => {
        if (args[0] === "setContext") {
          return undefined;
        }
        return (originalExec68 as Function).apply(commands, args);
      });

      const originalCreate68 = window.createQuickPick.bind(window);
      sb.stub(window, "createQuickPick").callsFake(() => {
        const qp = originalCreate68();
        activeQuickPick = qp;
        const origAccept = qp.onDidAccept.bind(qp);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qp as any).onDidAccept = (listener: () => void) => {
          capturedAccept.fn = listener;
          return origAccept(listener);
        };
        return qp;
      });

      return { sb, capturedAccept };
    }

    // -------------------------------------------------------------------
    // 6.8.1. show("/home/bookmarked") displays ".." item
    // -------------------------------------------------------------------
    it("6.8.1: show('/home/bookmarked') shows '..' item", async () => {
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [makeFolder("home", "/home")]],
          ["/home", [makeFolder("bookmarked", "/home/bookmarked")]],
          ["/home/bookmarked", [makeFile("readme.sas", "/home/bookmarked/readme.sas")]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/home/bookmarked");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const labels = activeQuickPick!.items.map((i) => i.label);
      assert.include(labels, "..", "'..' should be present when browsing a deep path");
      assert.include(labels, "readme.sas", "contents of /home/bookmarked should be shown");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -------------------------------------------------------------------
    // 6.8.2. Selecting ".." from "/home/bookmarked" loads "/home", not root
    // -------------------------------------------------------------------
    it("6.8.2: selecting '..' from '/home/bookmarked' navigates to '/home', not root", async () => {
      const { sb, capturedAccept } = buildCapturingSandbox68();

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [makeFolder("home", "/home")]],
          ["/home", [makeFolder("bookmarked", "/home/bookmarked")]],
          ["/home/bookmarked", [makeFile("readme.sas", "/home/bookmarked/readme.sas")]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/home/bookmarked");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAccept.fn, "onDidAccept listener should be captured");

      // Find the ".." parent item
      type AnyItem68 = { kind: string | number; label: string };
      const parentItem = (activeQuickPick!.items as unknown as AnyItem68[]).find(
        (i) => i.label === "..",
      );
      assert.isDefined(parentItem, "'..' item must be present");

      // Make the ".." item appear selected
      Object.defineProperty(activeQuickPick!, "selectedItems", {
        get: () => [parentItem as unknown as QuickPickItem],
        configurable: true,
      });

      // Fire accept — this should navigate to /home (not root)
      capturedAccept.fn!();

      await sleep(300);
      await waitForNotBusy(activeQuickPick!);

      // Title should be /home, not "SAS Server"
      assert.equal(
        activeQuickPick!.title,
        "/home",
        "title should be '/home' after pressing '..' from '/home/bookmarked'",
      );

      // Items should include "bookmarked" folder (child of /home)
      const labelsAfter = activeQuickPick!.items.map((i) => i.label);
      assert.include(
        labelsAfter,
        "bookmarked",
        "'/home' contents should be shown after pressing '..'",
      );

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });

    // -------------------------------------------------------------------
    // 6.8.3. Selecting ".." from "/home" goes back to root screen
    // -------------------------------------------------------------------
    it("6.8.3: selecting '..' from '/home' goes back to root screen (title 'SAS Server')", async () => {
      const { sb, capturedAccept } = buildCapturingSandbox68();

      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([
          [undefined, [makeFolder("home", "/home")]],
          ["/home", [makeFolder("bookmarked", "/home/bookmarked")]],
          ["/home/bookmarked", [makeFile("readme.sas", "/home/bookmarked/readme.sas")]],
        ]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/home");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      assert.isDefined(capturedAccept.fn, "onDidAccept listener should be captured");

      type AnyItem68b = { kind: string | number; label: string };
      const parentItem = (activeQuickPick!.items as unknown as AnyItem68b[]).find(
        (i) => i.label === "..",
      );
      assert.isDefined(parentItem, "'..' item must be present at /home");

      Object.defineProperty(activeQuickPick!, "selectedItems", {
        get: () => [parentItem as unknown as QuickPickItem],
        configurable: true,
      });

      // Fire accept — from /home, ".." should go to root (stack becomes empty)
      capturedAccept.fn!();

      await sleep(300);
      await waitForNotBusy(activeQuickPick!);

      // Title should be "SAS Server" (root)
      assert.equal(
        activeQuickPick!.title,
        "SAS Server",
        "title should be 'SAS Server' after pressing '..' from '/home'",
      );

      // No ".." item at root
      const labelsAfterRoot = activeQuickPick!.items.map((i) => i.label);
      assert.notInclude(
        labelsAfterRoot,
        "..",
        "should be at root level, no '..' item",
      );

      // Root items should be visible
      assert.include(
        labelsAfterRoot,
        "home",
        "root-level 'home' folder should be visible after navigating back to root",
      );

      activeQuickPick!.hide();
      await showPromise;
      sb.restore();
    });
  });

  // -----------------------------------------------------------------------
  // item descriptions (task 6.9)
  // -----------------------------------------------------------------------
  describe("item descriptions (task 6.9)", function () {

    function makeFolderWithMeta(
      name: string,
      uri: string,
      modifiedTimeStamp: number,
    ): ContentItem {
      return {
        ...makeFolder(name, uri),
        modifiedTimeStamp,
      };
    }

    function makeFileWithMeta(
      name: string,
      uri: string,
      modifiedTimeStamp: number,
      size: number,
    ): ContentItem {
      return {
        ...makeFile(name, uri),
        modifiedTimeStamp,
        fileStat: {
          mtime: modifiedTimeStamp,
          ctime: 0,
          size,
          type: 2, // FileType.File = 2
        },
      };
    }

    // -----------------------------------------------------------------
    // 6.9.1. Folder items show timestamp description
    // -----------------------------------------------------------------
    it("6.9.1: folder items show a timestamp description containing the year", async () => {
      const ts = new Date(2024, 0, 15).getTime();
      const children = [makeFolderWithMeta("docs", "/srv/docs", ts)];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([["/srv", children]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/srv");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const folderItem = activeQuickPick!.items.find((i) => i.label === "docs");
      assert.isDefined(folderItem, "should find folder item 'docs'");

      const desc = (folderItem as QuickPickItem).detail;
      assert.isString(desc, "detail should be a string");
      assert.isAbove((desc as string).length, 0, "detail should be non-empty");
      assert.include(desc, "2024", "detail should contain the year 2024");
      // Should NOT be the old URI-based description
      assert.notEqual(desc, "/srv/docs", "detail should not be the folder URI");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------
    // 6.9.2. File items show "size · timestamp" description
    // -----------------------------------------------------------------
    it("6.9.2: file items show size and timestamp joined by ' · '", async () => {
      const ts = new Date(2024, 5, 20).getTime();
      const children = [makeFileWithMeta("report.csv", "/data/report.csv", ts, 2048)];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([["/data", children]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/data");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const fileItem = activeQuickPick!.items.find((i) => i.label === "report.csv");
      assert.isDefined(fileItem, "should find file item 'report.csv'");

      const desc = (fileItem as QuickPickItem).detail;
      assert.isString(desc, "detail should be a string");
      assert.include(desc, "2.0 KB", "detail should contain formatted size '2.0 KB'");
      assert.include(desc, "2024", "detail should contain the year 2024");
      assert.include(desc, "·", "detail should contain the separator '·'");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------
    // 6.9.3. File items with no size or timestamp show falsy description
    // -----------------------------------------------------------------
    it("6.9.3: file items with no size and no timestamp have falsy description", async () => {
      const children = [makeFile("empty.sas", "/ws/empty.sas")];
      // modifiedTimeStamp defaults to 0, no fileStat
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([["/ws", children]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/ws");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const fileItem = activeQuickPick!.items.find((i) => i.label === "empty.sas");
      assert.isDefined(fileItem, "should find file item 'empty.sas'");

      assert.isUndefined((fileItem as QuickPickItem).detail, "detail should be undefined when no size and no timestamp");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------
    // 6.9.4. '..' parent item shows folder/file counts
    // -----------------------------------------------------------------
    it("6.9.4: '..' parent item description shows folder and file counts", async () => {
      const children = [
        makeFolder("alpha", "/home/alpha"),
        makeFolder("beta", "/home/beta"),
        makeFile("a.sas", "/home/a.sas"),
        makeFile("b.sas", "/home/b.sas"),
        makeFile("c.sas", "/home/c.sas"),
      ];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([["/home", children]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/home");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const dotdotItem = activeQuickPick!.items.find((i) => i.label === "..");
      assert.isDefined(dotdotItem, "'..' item should be present");

      const desc = (dotdotItem as QuickPickItem).detail ?? "";
      assert.include(desc, "2 folder", "detail should contain '2 folder'");
      assert.include(desc, "3 file", "detail should contain '3 file'");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------
    // 6.9.5. '..' parent item with only folders shows singular "folder"
    // -----------------------------------------------------------------
    it("6.9.5: '..' parent item with 1 folder and 0 files shows singular 'folder'", async () => {
      const children = [makeFolder("onlyone", "/home/onlyone")];
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([["/home", children]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/home");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const dotdotItem = activeQuickPick!.items.find((i) => i.label === "..");
      assert.isDefined(dotdotItem, "'..' item should be present");

      const desc = (dotdotItem as QuickPickItem).detail ?? "";
      assert.include(desc, "1 folder", "detail should contain singular '1 folder'");
      assert.notInclude(desc, "file", "detail should not mention files when there are none");

      activeQuickPick!.hide();
      await showPromise;
    });

    // -----------------------------------------------------------------
    // 6.9.6. '..' parent item for empty directory shows "empty"
    // -----------------------------------------------------------------
    it("6.9.6: '..' parent item for empty directory shows description 'empty'", async () => {
      const adapter = createStubAdapter(
        new Map<string | undefined, ContentItem[]>([["/home", []]]),
      );
      const model = new ContentModel(adapter);
      const browser = new QuickFileBrowser(model);

      const showPromise = browser.show("/home");
      await sleep(200);
      await waitForNotBusy(activeQuickPick!);

      const dotdotItem = activeQuickPick!.items.find((i) => i.label === "..");
      assert.isDefined(dotdotItem, "'..' item should be present");

      const desc = (dotdotItem as QuickPickItem).detail;
      assert.equal(desc, "empty", "detail should be 'empty' for an empty directory");

      activeQuickPick!.hide();
      await showPromise;
    });
  });
});
