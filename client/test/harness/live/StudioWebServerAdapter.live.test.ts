// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Live tests for StudioWebServerAdapter against the real SAS Studio server.
// Requires LIVE_SERVER=1 and a running SAS Studio instance at 192.168.0.141.
import { FileType, Uri } from "vscode";

import { expect } from "chai";

import StudioWebServerAdapter from "../../../src/connection/studioweb/StudioWebServerAdapter";
import * as state from "../../../src/connection/studioweb/state";
import { ContentItem } from "../../../src/components/ContentNavigator/types";
import { SERVER_FOLDER_ID } from "../../../src/components/ContentNavigator/const";
import { LIVE_ENDPOINT, LiveSession, createLiveSession, deleteLiveSession } from "./session";

const LIVE = process.env.LIVE_SERVER === "1";
const maybeIt = LIVE ? it : it.skip;

const TIMESTAMP = Date.now();
const MY_FOLDERS = "/folders/myfolders";
const TEST_DIR = `${MY_FOLDERS}/vscode-ext-test-${TIMESTAMP}`;

describe("StudioWebServerAdapter — live", function () {
  this.timeout(60000);

  let liveSession: LiveSession;
  let adapter: StudioWebServerAdapter;

  before(async function () {
    if (!LIVE) return;
    liveSession = await createLiveSession();
    state.setCredentials({
      endpoint: LIVE_ENDPOINT,
      sessionId: liveSession.sessionId,
    });
    adapter = new StudioWebServerAdapter(undefined, undefined);
    await adapter.getRootItems(); // initialize rootFolders

    // Create the test working directory inside My Folders (the only writable tree-store path)
    const testDir = await adapter.createNewFolder(
      {
        id: MY_FOLDERS,
        uid: MY_FOLDERS,
        uri: MY_FOLDERS,
        name: "myfolders",
        type: "",
        creationTimeStamp: 0,
        modifiedTimeStamp: 0,
        links: [
          {
            method: "GET",
            rel: "getDirectoryMembers",
            href: MY_FOLDERS,
            uri: MY_FOLDERS,
            type: "GET",
          },
        ],
        parentFolderUri: "/folders",
        permission: { write: true, delete: true, addMember: true },
        fileStat: { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 },
      },
      `vscode-ext-test-${TIMESTAMP}`,
    );
    if (!testDir) {
      throw new Error("Failed to create test directory " + TEST_DIR);
    }
  });

  after(async function () {
    if (LIVE && adapter) {
      // Clean up test directory
      try {
        const testItem: ContentItem = {
          id: TEST_DIR,
          uid: TEST_DIR,
          uri: TEST_DIR,
          name: `vscode-ext-test-${TIMESTAMP}`,
          type: "",
          creationTimeStamp: 0,
          modifiedTimeStamp: 0,
          links: [],
          parentFolderUri: MY_FOLDERS,
          permission: { write: true, delete: true, addMember: true },
          fileStat: { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 },
        };
        await adapter.deleteItem(testItem);
      } catch {
        // Best-effort cleanup
      }
    }
    state.setCredentials(undefined);
    if (!LIVE || !liveSession) return;
    await deleteLiveSession(liveSession.sessionId);
  });

  // Helper: build a ContentItem for a path in the test dir
  const makeTestItem = (
    name: string,
    isDir = false,
    parent = TEST_DIR,
  ): ContentItem => ({
    id: `${parent}/${name}`,
    uid: `${parent}/${name}`,
    uri: `${parent}/${name}`,
    name,
    type: "",
    creationTimeStamp: 0,
    modifiedTimeStamp: 0,
    links: isDir
      ? [
          {
            method: "GET",
            rel: "getDirectoryMembers",
            href: `${parent}/${name}`,
            uri: `${parent}/${name}`,
            type: "GET",
          },
        ]
      : [],
    parentFolderUri: parent,
    permission: { write: true, delete: true, addMember: isDir },
    fileStat: {
      type: isDir ? FileType.Directory : FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
    },
  });

  const makeTestDir = (): ContentItem => ({
    id: TEST_DIR,
    uid: TEST_DIR,
    uri: TEST_DIR,
    name: `vscode-ext-test-${TIMESTAMP}`,
    type: "",
    creationTimeStamp: 0,
    modifiedTimeStamp: 0,
    links: [
      {
        method: "GET",
        rel: "getDirectoryMembers",
        href: TEST_DIR,
        uri: TEST_DIR,
        type: "GET",
      },
    ],
    parentFolderUri: MY_FOLDERS,
    permission: { write: true, delete: true, addMember: true },
    fileStat: { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 },
  });

  // ---------------------------------------------------------------------------
  // getRootItems
  // ---------------------------------------------------------------------------

  maybeIt("getRootItems() returns a non-empty map", async () => {
    const rootMap = await adapter.getRootItems();

    expect(Object.keys(rootMap)).to.have.length.at.least(1);
    const root = Object.values(rootMap)[0];
    expect(root).to.have.property("id");
  });

  // ---------------------------------------------------------------------------
  // getChildItems
  // ---------------------------------------------------------------------------

  maybeIt("getChildItems(root) returns server root children", async () => {
    const rootMap = await adapter.getRootItems();
    const root = Object.values(rootMap)[0];
    const rootVirtual: ContentItem = {
      ...root,
      id: SERVER_FOLDER_ID,
      uid: SERVER_FOLDER_ID,
      uri: SERVER_FOLDER_ID,
    };

    const items = await adapter.getChildItems(rootVirtual);

    expect(items).to.be.an("array").that.is.not.empty;
    expect(items.every((i) => i.name)).to.be.true;
  });

  maybeIt("getChildItems(test dir) lists created items", async () => {
    // Create a file first
    const newFile = await adapter.createNewItem(
      makeTestDir(),
      "list-test.sas",
      new TextEncoder().encode("/* test */"),
    );
    expect(newFile).to.not.be.undefined;

    const items = await adapter.getChildItems(makeTestDir());
    const found = items.find((i) => i.name === "list-test.sas");
    expect(found, "list-test.sas should appear in getChildItems").to.not.be
      .undefined;
  });

  // ---------------------------------------------------------------------------
  // createNewFolder
  // ---------------------------------------------------------------------------

  maybeIt("createNewFolder creates a visible subdirectory", async () => {
    const result = await adapter.createNewFolder(makeTestDir(), "subdir1");

    expect(result).to.not.be.undefined;
    expect(result!.fileStat!.type).to.equal(FileType.Directory);

    const items = await adapter.getChildItems(makeTestDir());
    const found = items.find((i) => i.name === "subdir1");
    expect(found, "subdir1 should be visible after creation").to.not.be
      .undefined;
  });

  // ---------------------------------------------------------------------------
  // createNewItem
  // ---------------------------------------------------------------------------

  maybeIt("createNewItem creates a visible file", async () => {
    const content = "data _null_; run;";
    const result = await adapter.createNewItem(
      makeTestDir(),
      "test-create.sas",
      new TextEncoder().encode(content),
    );

    expect(result).to.not.be.undefined;
    expect(result!.fileStat!.type).to.equal(FileType.File);

    const items = await adapter.getChildItems(makeTestDir());
    const found = items.find((i) => i.name === "test-create.sas");
    expect(found, "test-create.sas should appear in getChildItems").to.not.be
      .undefined;
  });

  maybeIt("createNewItem returns undefined for duplicate file name", async () => {
    // First create
    await adapter.createNewItem(makeTestDir(), "dup.sas");
    // Second create of same name
    const result = await adapter.createNewItem(makeTestDir(), "dup.sas");
    expect(result).to.be.undefined;
  });

  // ---------------------------------------------------------------------------
  // getContentOfItem / updateContentOfItem round-trip
  // ---------------------------------------------------------------------------

  maybeIt("write and read back file content", async () => {
    const content = "data _null_; put 'hello'; run;";
    await adapter.createNewItem(
      makeTestDir(),
      "rw-test.sas",
      new TextEncoder().encode(content),
    );

    const fileItem = makeTestItem("rw-test.sas");
    const readBack = await adapter.getContentOfItem(fileItem);
    expect(readBack).to.equal(content);
  });

  maybeIt("updateContentOfItem changes file content", async () => {
    const initial = "/* initial */";
    const updated = "/* updated */";

    await adapter.createNewItem(
      makeTestDir(),
      "update-test.sas",
      new TextEncoder().encode(initial),
    );
    const fileUri = Uri.parse(`sasServer:${TEST_DIR}/update-test.sas`);
    await adapter.updateContentOfItem(fileUri, updated);

    const fileItem = makeTestItem("update-test.sas");
    const readBack = await adapter.getContentOfItem(fileItem);
    expect(readBack).to.equal(updated);
  });

  // ---------------------------------------------------------------------------
  // renameItem
  // ---------------------------------------------------------------------------

  maybeIt("renameItem changes item name and it appears in getChildItems", async () => {
    await adapter.createNewItem(makeTestDir(), "before-rename.sas");
    const item = makeTestItem("before-rename.sas");

    const renamed = await adapter.renameItem(item, "after-rename.sas");

    expect(renamed).to.not.be.undefined;
    expect(renamed!.name).to.equal("after-rename.sas");

    const items = await adapter.getChildItems(makeTestDir());
    expect(items.find((i) => i.name === "after-rename.sas"), "renamed item should appear").to.not.be.undefined;
    expect(items.find((i) => i.name === "before-rename.sas"), "old name should be gone").to.be.undefined;
  });

  // ---------------------------------------------------------------------------
  // deleteItem
  // ---------------------------------------------------------------------------

  maybeIt("deleteItem removes item from getChildItems", async () => {
    await adapter.createNewItem(makeTestDir(), "to-delete.sas");
    const item = makeTestItem("to-delete.sas");

    const deleted = await adapter.deleteItem(item);
    expect(deleted).to.equal(true);

    const items = await adapter.getChildItems(makeTestDir());
    expect(items.find((i) => i.name === "to-delete.sas"), "deleted item should be gone").to.be.undefined;
  });

  // ---------------------------------------------------------------------------
  // moveItem
  // ---------------------------------------------------------------------------

  maybeIt("moveItem moves file to target folder", async () => {
    // Create source folder and target folder
    await adapter.createNewFolder(makeTestDir(), "src-folder");
    await adapter.createNewFolder(makeTestDir(), "tgt-folder");

    const srcFolder = makeTestItem("src-folder", true);
    await adapter.createNewItem(srcFolder, "move-me.sas");

    const moveItem = makeTestItem("move-me.sas", false, `${TEST_DIR}/src-folder`);
    const targetUri = `${TEST_DIR}/tgt-folder`;

    const result = await adapter.moveItem(moveItem, targetUri);

    expect(result).to.not.be.undefined;
    expect(result!.path).to.include("move-me.sas");

    // Should be present in target
    const tgtItems = await adapter.getChildItems(
      makeTestItem("tgt-folder", true),
    );
    expect(
      tgtItems.find((i) => i.name === "move-me.sas"),
      "move-me.sas should be in target folder",
    ).to.not.be.undefined;

    // Should be absent from source
    const srcItems = await adapter.getChildItems(srcFolder);
    expect(
      srcItems.find((i) => i.name === "move-me.sas"),
      "move-me.sas should be gone from source folder",
    ).to.be.undefined;
  });
});
