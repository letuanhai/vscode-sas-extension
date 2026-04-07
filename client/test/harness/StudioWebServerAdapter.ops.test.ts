// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tests for StudioWebServerAdapter — workspaceUrl encoding, CRUD operations.
import { FileType, Uri } from "vscode";

import { expect } from "chai";
import * as sinon from "sinon";

import StudioWebServerAdapter from "../../src/connection/studioweb/StudioWebServerAdapter";
import * as studiwebIndex from "../../src/connection/studioweb/index";
import * as state from "../../src/connection/studioweb/state";
import { ContentItem } from "../../src/components/ContentNavigator/types";
import { SERVER_FOLDER_ID } from "../../src/components/ContentNavigator/const";

const SESSION_ID = "test-srv-session";

const makeAxiosMock = () => ({
  get: sinon.stub(),
  post: sinon.stub(),
  put: sinon.stub(),
  delete: sinon.stub(),
  defaults: { baseURL: "http://sas.test/SASStudio/38/sasexec" },
});

const makeItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: "/folders/myfolders/test/file.sas",
  uid: "/folders/myfolders/test/file.sas",
  uri: "/folders/myfolders/test/file.sas",
  name: "file.sas",
  creationTimeStamp: 0,
  modifiedTimeStamp: 0,
  links: [
    {
      method: "GET",
      rel: "getDirectoryMembers",
      href: "/folders/myfolders/test",
      uri: "/folders/myfolders/test",
      type: "GET",
    },
  ],
  parentFolderUri: "/folders/myfolders/test",
  permission: { write: true, delete: true, addMember: false },
  fileStat: { type: FileType.File, ctime: 0, mtime: 0, size: 0 },
  ...overrides,
});

const makeFolderItem = (overrides: Partial<ContentItem> = {}): ContentItem =>
  makeItem({
    id: "/folders/myfolders/test",
    uid: "/folders/myfolders/test",
    uri: "/folders/myfolders/test",
    name: "test",
    parentFolderUri: "/folders/myfolders",
    permission: { write: true, delete: true, addMember: true },
    fileStat: { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 },
    links: [
      {
        method: "GET",
        rel: "getDirectoryMembers",
        href: "/folders/myfolders/test",
        uri: "/folders/myfolders/test",
        type: "GET",
      },
    ],
    ...overrides,
  });

describe("StudioWebServerAdapter — CRUD operations", () => {
  let sandbox: sinon.SinonSandbox;
  let adapter: StudioWebServerAdapter;
  let axiosMock: ReturnType<typeof makeAxiosMock>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    adapter = new StudioWebServerAdapter(undefined, undefined);
    axiosMock = makeAxiosMock();

    sandbox.stub(studiwebIndex, "ensureCredentials").resolves(true);
    sandbox.stub(state, "getAxios").returns(axiosMock as never);
    sandbox.stub(state, "getCredentials").returns({
      endpoint: "http://sas.test/SASStudio/38",
      sessionId: SESSION_ID,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // workspaceUrl encoding
  // ---------------------------------------------------------------------------
  describe("workspaceUrl — encodeDoubleSlashes", () => {
    it("does NOT encode // when encodeDoubleSlashes=false (default)", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.get.resolves({ data: new ArrayBuffer(0) });

      const item = makeItem({ uri: "//path/to/file.sas" });
      await adapter.getContentOfItem(item);

      const url: string = axiosMock.get.firstCall.args[0];
      expect(url).to.include("//path/to/file.sas");
      expect(url).to.not.include("~~ds~~");
    });

    it("encodes // as /~~ds~~ when encodeDoubleSlashes=true", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(true);
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      axiosMock.get.resolves({ data: new ArrayBuffer(0) });

      const item = makeItem({ uri: "//path/to/file.sas" });
      await adapter.getContentOfItem(item);

      const url: string = axiosMock.get.firstCall.args[0];
      expect(url).to.include("/~~ds~~");
      expect(url).to.not.include("//path");
    });
  });

  // ---------------------------------------------------------------------------
  // getChildItems — root folder
  // ---------------------------------------------------------------------------
  describe("getChildItems(root)", () => {
    it("GETs /{sessionId}/_root_ for root folder", async () => {
      axiosMock.get.resolves({
        data: {
          id: "_root_",
          isDirectory: true,
          children: [
            { name: "My Folders", isDirectory: true, uri: "/folders/myfolders" },
          ],
        },
      });

      const rootItem = makeItem({
        id: SERVER_FOLDER_ID,
        uid: SERVER_FOLDER_ID,
        uri: SERVER_FOLDER_ID,
        name: "SAS Server",
      });

      const items = await adapter.getChildItems(rootItem);

      expect(axiosMock.get.calledOnce).to.be.true;
      const url: string = axiosMock.get.firstCall.args[0];
      expect(url).to.equal(`/${SESSION_ID}/_root_`);
      expect(items.length).to.be.at.least(1);
      expect(items[0].name).to.equal("My Folders");
    });

    it("returns fallback home folder when _root_ children is empty", async () => {
      axiosMock.get.resolves({
        data: { id: "_root_", isDirectory: true, children: [] },
      });

      const rootItem = makeItem({
        id: SERVER_FOLDER_ID,
        uid: SERVER_FOLDER_ID,
        uri: SERVER_FOLDER_ID,
        name: "SAS Server",
      });

      const items = await adapter.getChildItems(rootItem);
      expect(items.length).to.equal(1);
    });

    it("maps root children to ContentItems with correct file types", async () => {
      axiosMock.get.resolves({
        data: {
          children: [
            { name: "My Folders", isDirectory: true, uri: "/folders/myfolders" },
          ],
        },
      });

      const rootItem = makeItem({
        id: SERVER_FOLDER_ID,
        uid: SERVER_FOLDER_ID,
        uri: SERVER_FOLDER_ID,
        name: "SAS Server",
      });

      const items = await adapter.getChildItems(rootItem);
      expect(items[0].fileStat!.type).to.equal(FileType.Directory);
    });
  });

  // ---------------------------------------------------------------------------
  // getChildItems — normal folder
  // ---------------------------------------------------------------------------
  describe("getChildItems(folder)", () => {
    it("uses getDirectoryMembers link URI for directory listing", async () => {
      axiosMock.get.resolves({
        data: { children: [{ name: "file.sas", uri: "/folders/myfolders/test/file.sas" }] },
      });

      const folder = makeFolderItem();
      await adapter.getChildItems(folder);

      const url: string = axiosMock.get.firstCall.args[0];
      // Should encode the directory path
      expect(url).to.include("~ps~folders~ps~myfolders~ps~test");
    });

    it("falls back to parentItem.uri if no getDirectoryMembers link", async () => {
      axiosMock.get.resolves({ data: { children: [] } });

      const folder = makeFolderItem({ links: [] });
      await adapter.getChildItems(folder);

      const url: string = axiosMock.get.firstCall.args[0];
      // Should use the item's URI, encoded
      expect(url).to.include("~ps~folders~ps~myfolders~ps~test");
    });

    it("handles data.children response format", async () => {
      axiosMock.get.resolves({
        data: {
          children: [
            { name: "a.sas", uri: "/folders/myfolders/test/a.sas" },
            { name: "b.sas", uri: "/folders/myfolders/test/b.sas" },
          ],
        },
      });

      const items = await adapter.getChildItems(makeFolderItem());
      expect(items.length).to.equal(2);
    });

    it("handles bare array response format", async () => {
      axiosMock.get.resolves({
        data: [
          { name: "a.sas", uri: "/folders/myfolders/test/a.sas" },
        ],
      });

      const items = await adapter.getChildItems(makeFolderItem());
      expect(items.length).to.equal(1);
    });

    it("handles data.items response format", async () => {
      axiosMock.get.resolves({
        data: {
          items: [
            { name: "a.sas", uri: "/folders/myfolders/test/a.sas" },
          ],
        },
      });

      const items = await adapter.getChildItems(makeFolderItem());
      expect(items.length).to.equal(1);
    });

    it("filters out entries without a name", async () => {
      axiosMock.get.resolves({
        data: {
          children: [
            { name: "valid.sas", uri: "/folders/myfolders/test/valid.sas" },
            { uri: "/folders/myfolders/test/unnamed" }, // no name
          ],
        },
      });

      const items = await adapter.getChildItems(makeFolderItem());
      expect(items.length).to.equal(1);
      expect(items[0].name).to.equal("valid.sas");
    });
  });

  // ---------------------------------------------------------------------------
  // getContentOfItem
  // ---------------------------------------------------------------------------
  describe("getContentOfItem()", () => {
    it("GETs the workspace URL with arraybuffer responseType", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      const content = "data _null_; run;";
      // Use a dedicated ArrayBuffer to avoid Node.js Buffer pool contamination
      const encoded = new TextEncoder().encode(content);
      const arrayBuf = encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      );
      axiosMock.get.resolves({ data: arrayBuf });

      const item = makeItem();
      const result = await adapter.getContentOfItem(item);

      expect(axiosMock.get.calledOnce).to.be.true;
      const [, config] = axiosMock.get.firstCall.args;
      expect(config?.responseType).to.equal("arraybuffer");
      expect(result).to.equal(content);
    });

    it("returns empty string on error", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.get.rejects(new Error("not found"));

      const result = await adapter.getContentOfItem(makeItem());
      expect(result).to.equal("");
    });
  });

  // ---------------------------------------------------------------------------
  // updateContentOfItem
  // ---------------------------------------------------------------------------
  describe("updateContentOfItem()", () => {
    it("POSTs to workspace URL with correct Content-Type", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.post.resolves({ status: 200 });

      const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
      await adapter.updateContentOfItem(uri, "content here");

      expect(axiosMock.post.calledOnce).to.be.true;
      const [, , config] = axiosMock.post.firstCall.args;
      expect(config?.headers?.["Content-Type"]).to.include("text/plain");
    });

    it("omits encoding param for UTF-8 server", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.post.resolves({ status: 200 });

      const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
      await adapter.updateContentOfItem(uri, "content");

      const [, , config] = axiosMock.post.firstCall.args;
      expect(config?.params).to.deep.equal({});
    });

    it("includes encoding param for non-UTF-8 server", async () => {
      sandbox.stub(state, "getServerEncoding").returns("ISO-8859-1");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.post.resolves({ status: 200 });

      const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
      await adapter.updateContentOfItem(uri, "content");

      const [, , config] = axiosMock.post.firstCall.args;
      expect(config?.params).to.deep.equal({ encoding: "ISO-8859-1" });
    });
  });

  // ---------------------------------------------------------------------------
  // createNewItem
  // ---------------------------------------------------------------------------
  describe("createNewItem()", () => {
    it("creates a file and returns ContentItem", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      // First GET: getChildItems (no existing children)
      axiosMock.get.resolves({ data: { children: [] } });
      axiosMock.post.resolves({ status: 200 });

      const parent = makeFolderItem();
      const result = await adapter.createNewItem(parent, "new.sas");

      expect(result).to.not.be.undefined;
      expect(result!.name).to.equal("new.sas");
      expect(result!.fileStat!.type).to.equal(FileType.File);
    });

    it("returns undefined when a file with the same name already exists", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.get.resolves({
        data: {
          children: [
            {
              name: "new.sas",
              uri: "/folders/myfolders/test/new.sas",
            },
          ],
        },
      });

      const parent = makeFolderItem();
      const result = await adapter.createNewItem(parent, "new.sas");

      expect(result).to.be.undefined;
      // POST should not have been called
      expect(axiosMock.post.notCalled).to.be.true;
    });

    it("returns undefined on POST error", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.get.resolves({ data: { children: [] } });
      axiosMock.post.rejects(new Error("error"));

      const result = await adapter.createNewItem(makeFolderItem(), "new.sas");
      expect(result).to.be.undefined;
    });

    it("sends binary buffer as application/octet-stream without corruption", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.get.resolves({ data: { children: [] } });
      axiosMock.post.resolves({ status: 200 });

      // ZIP magic bytes + high bytes that TextDecoder("utf-8") would corrupt
      const zipBytes = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, // ZIP magic bytes (PK\x03\x04)
        0x80, 0xff, 0xfe, 0x00, // high bytes that are invalid UTF-8
        0x01, 0x02, 0x03, 0x04,
      ]);
      const arrayBuf = zipBytes.buffer.slice(
        zipBytes.byteOffset,
        zipBytes.byteOffset + zipBytes.byteLength,
      );

      const parent = makeFolderItem();
      const result = await adapter.createNewItem(parent, "archive.zip", arrayBuf);

      expect(result).to.not.be.undefined;
      expect(result!.name).to.equal("archive.zip");

      // Verify POST was called once
      expect(axiosMock.post.calledOnce).to.be.true;
      const [, body, config] = axiosMock.post.firstCall.args;

      // Body must be a Buffer instance (raw bytes), not a string
      expect(Buffer.isBuffer(body)).to.be.true;

      // Content-Type must be application/octet-stream
      expect(config?.headers?.["Content-Type"]).to.equal("application/octet-stream");

      // Exact bytes must be preserved — no UTF-8 replacement characters
      const sentBytes = new Uint8Array(body as Buffer);
      expect(sentBytes.length).to.equal(zipBytes.length);
      for (let i = 0; i < zipBytes.length; i++) {
        expect(sentBytes[i]).to.equal(
          zipBytes[i],
          `byte at index ${i} should be 0x${zipBytes[i].toString(16).padStart(2, "0")}`,
        );
      }

      // Spot-check: ZIP magic bytes are intact
      expect(sentBytes[0]).to.equal(0x50); // 'P'
      expect(sentBytes[1]).to.equal(0x4b); // 'K'
      expect(sentBytes[2]).to.equal(0x03);
      expect(sentBytes[3]).to.equal(0x04);

      // Spot-check: high bytes are NOT corrupted to 0xef 0xbf 0xbd (UTF-8 U+FFFD)
      expect(sentBytes[4]).to.equal(0x80);
      expect(sentBytes[5]).to.equal(0xff);
    });

    it("sends empty string with text/plain for empty file creation (no buffer)", async () => {
      sandbox.stub(state, "getServerEncoding").returns("UTF-8");
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.get.resolves({ data: { children: [] } });
      axiosMock.post.resolves({ status: 200 });

      const parent = makeFolderItem();
      const result = await adapter.createNewItem(parent, "empty.sas");

      expect(result).to.not.be.undefined;
      expect(axiosMock.post.calledOnce).to.be.true;

      const [, body, config] = axiosMock.post.firstCall.args;

      // Body must be empty string for empty file creation
      expect(body).to.equal("");

      // Content-Type must be text/plain
      expect(config?.headers?.["Content-Type"]).to.include("text/plain");
    });
  });

  // ---------------------------------------------------------------------------
  // createNewFolder
  // ---------------------------------------------------------------------------
  describe("createNewFolder()", () => {
    it("PUTs updated parent with new folder appended to children", async () => {
      axiosMock.get.resolves({
        data: {
          name: "test",
          children: [],
        },
      });
      axiosMock.put.resolves({ status: 200 });

      const parent = makeFolderItem();
      const result = await adapter.createNewFolder(parent, "subfolder");

      expect(result).to.not.be.undefined;
      expect(result!.name).to.equal("subfolder");
      expect(result!.fileStat!.type).to.equal(FileType.Directory);

      expect(axiosMock.put.calledOnce).to.be.true;
      const [, body] = axiosMock.put.firstCall.args;
      const newChild = body.children[body.children.length - 1];
      expect(newChild.isDirectory).to.equal(true);
      expect(newChild.name).to.equal("subfolder");
    });

    it("returns undefined on error", async () => {
      axiosMock.get.rejects(new Error("error"));

      const result = await adapter.createNewFolder(makeFolderItem(), "subfolder");
      expect(result).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // deleteItem
  // ---------------------------------------------------------------------------
  describe("deleteItem()", () => {
    it("sends DELETE to workspace URL and returns true", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.delete.resolves({ status: 200 });

      const result = await adapter.deleteItem(makeItem());

      expect(result).to.equal(true);
      expect(axiosMock.delete.calledOnce).to.be.true;
      const url: string = axiosMock.delete.firstCall.args[0];
      expect(url).to.include("/folders/myfolders/test/file.sas");
    });

    it("returns false on error", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.delete.rejects(new Error("error"));

      const result = await adapter.deleteItem(makeItem());
      expect(result).to.equal(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getContentOfItemRaw
  // ---------------------------------------------------------------------------
  describe("getContentOfItemRaw()", () => {
    it("returns exact raw bytes without any encoding applied", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);

      // Raw binary payload including high bytes and ZIP magic bytes
      const rawBytes = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, // ZIP magic bytes
        0x80, 0xff, 0xfe, 0x00, // high bytes that UTF-8 would corrupt
        0x01, 0x02, 0x03, 0x04,
      ]);
      const arrayBuf = rawBytes.buffer.slice(
        rawBytes.byteOffset,
        rawBytes.byteOffset + rawBytes.byteLength,
      );
      axiosMock.get.resolves({ data: arrayBuf });

      const item = makeItem();
      const result = await adapter.getContentOfItemRaw(item);

      // Verify arraybuffer responseType was used
      expect(axiosMock.get.calledOnce).to.be.true;
      const [, config] = axiosMock.get.firstCall.args;
      expect(config?.responseType).to.equal("arraybuffer");

      // Verify every byte is preserved exactly (no encoding applied)
      expect(result.length).to.equal(rawBytes.length);
      for (let i = 0; i < rawBytes.length; i++) {
        expect(result[i]).to.equal(
          rawBytes[i],
          `byte at index ${i} should be 0x${rawBytes[i].toString(16).padStart(2, "0")}`,
        );
      }

      // Verify ZIP magic bytes
      expect(result[0]).to.equal(0x50);
      expect(result[1]).to.equal(0x4b);

      // Verify high bytes are NOT corrupted
      expect(result[4]).to.equal(0x80);
      expect(result[5]).to.equal(0xff);
    });

    it("returns empty Uint8Array on error", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.get.rejects(new Error("not found"));

      const result = await adapter.getContentOfItemRaw(makeItem());
      expect(result).to.be.instanceOf(Uint8Array);
      expect(result.length).to.equal(0);
    });
  });

  // ---------------------------------------------------------------------------
  // updateContentOfItemRaw
  // ---------------------------------------------------------------------------
  describe("updateContentOfItemRaw()", () => {
    it("POSTs raw bytes as application/octet-stream", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.post.resolves({ status: 200 });

      // Include high bytes that TextDecoder would corrupt with UTF-8 replacement chars
      const rawBytes = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04, // ZIP magic bytes
        0x80, 0xff, 0xfe, 0x00, // high bytes invalid in UTF-8
        0x01, 0x02, 0x03, 0x04,
      ]);

      const uri = Uri.parse("sasServer:/folders/myfolders/test/archive.zip");
      await adapter.updateContentOfItemRaw(uri, rawBytes);

      expect(axiosMock.post.calledOnce).to.be.true;
      const [, body, config] = axiosMock.post.firstCall.args;

      // Body must be a Buffer instance (raw bytes), not a string
      expect(Buffer.isBuffer(body)).to.be.true;

      // Content-Type must be application/octet-stream
      expect(config?.headers?.["Content-Type"]).to.equal(
        "application/octet-stream",
      );

      // Every byte must be preserved exactly
      const sentBytes = new Uint8Array(body as Buffer);
      expect(sentBytes.length).to.equal(rawBytes.length);
      for (let i = 0; i < rawBytes.length; i++) {
        expect(sentBytes[i]).to.equal(
          rawBytes[i],
          `byte at index ${i} should be 0x${rawBytes[i].toString(16).padStart(2, "0")}`,
        );
      }

      // Spot-check: high bytes are NOT corrupted to 0xef 0xbf 0xbd (U+FFFD)
      expect(sentBytes[4]).to.equal(0x80);
      expect(sentBytes[5]).to.equal(0xff);
    });

    it("returns void on success", async () => {
      sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
      axiosMock.post.resolves({ status: 200 });

      const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
      const result = await adapter.updateContentOfItemRaw(
        uri,
        new Uint8Array([0x68, 0x69]),
      );

      expect(result).to.be.undefined;
    });

    it("returns without throwing on credential failure", async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
      sandbox.stub(studiwebIndex, "ensureCredentials").resolves(false);
      // getAxios and getCredentials are never reached when ensureCredentials returns false

      const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
      const result = await adapter.updateContentOfItemRaw(uri, new Uint8Array([0x68, 0x69]));

      expect(result).to.be.undefined;
    });
  });

  // ---------------------------------------------------------------------------
  // moveItem
  // ---------------------------------------------------------------------------
  describe("moveItem()", () => {
    it("POSTs move operation with correct body and returns new Uri", async () => {
      axiosMock.post.resolves({ status: 200 });

      const item = makeItem();
      const targetUri = "/folders/myfolders/other";
      const result = await adapter.moveItem(item, targetUri);

      expect(result).to.not.be.undefined;
      expect(result!.toString()).to.include("sasServer:");
      expect(result!.path).to.include("file.sas");

      expect(axiosMock.post.calledOnce).to.be.true;
      const [url, body] = axiosMock.post.firstCall.args;
      expect(url).to.equal(`/${SESSION_ID}/`);
      expect(body.operationName).to.equal("move");
      expect(body.child).to.equal("file.sas");
      expect(body.newParent).to.equal(
        "~ps~folders~ps~myfolders~ps~other",
      );
      expect(body.oldParent).to.equal(
        "~ps~folders~ps~myfolders~ps~test",
      );
    });

    it("returns undefined on error", async () => {
      axiosMock.post.rejects(new Error("error"));

      const result = await adapter.moveItem(makeItem(), "/target");
      expect(result).to.be.undefined;
    });
  });
});
