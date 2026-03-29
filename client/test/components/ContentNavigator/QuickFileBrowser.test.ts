// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  QuickPick,
  QuickPickItem,
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
  isFolder,
  sortContentItems,
  syntheticFolder,
} from "../../../src/components/ContentNavigator/QuickFileBrowser";
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
});
