// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tests for encoding support: encodingMap, ContentModel raw read/write,
// StudioWebServerAdapter raw read and write-with-encoding.
import { FileType, Uri } from "vscode";

import { expect } from "chai";
import * as sinon from "sinon";

import { mapVscodeEncodingToSas } from "../../src/connection/studioweb/encodingMap";
import { ContentModel } from "../../src/components/ContentNavigator/ContentModel";
import {
  ContentAdapter,
  ContentItem,
} from "../../src/components/ContentNavigator/types";
import StudioWebServerAdapter from "../../src/connection/studioweb/StudioWebServerAdapter";
import * as studiwebIndex from "../../src/connection/studioweb/index";
import * as state from "../../src/connection/studioweb/state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SESSION_ID = "enc-test-session";

const makeAxiosMock = () => ({
  get: sinon.stub(),
  post: sinon.stub(),
  put: sinon.stub(),
  delete: sinon.stub(),
  defaults: { baseURL: "http://sas.test/SASStudio/38/sasexec" },
});

const makeItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: "/folders/myfolders/test/file.sas",
  uri: "/folders/myfolders/test/file.sas",
  name: "file.sas",
  creationTimeStamp: 0,
  modifiedTimeStamp: 0,
  links: [],
  parentFolderUri: "/folders/myfolders/test",
  permission: { write: true, delete: true, addMember: false },
  fileStat: { type: FileType.File, ctime: 0, mtime: 0, size: 0 },
  ...overrides,
});

/**
 * Build a minimal ContentAdapter stub with only the methods ContentModel
 * actually calls. Tests can override individual methods as needed.
 */
function makeAdapterStub(
  overrides: Partial<ContentAdapter> = {},
): ContentAdapter {
  return {
    addChildItem: sinon.stub().resolves(false),
    addItemToFavorites: sinon.stub().resolves(false),
    connect: sinon.stub().resolves(),
    connected: sinon.stub().returns(true),
    createNewFolder: sinon.stub().resolves(undefined),
    createNewItem: sinon.stub().resolves(undefined),
    deleteItem: sinon.stub().resolves(false),
    getChildItems: sinon.stub().resolves([]),
    getContentOfItem: sinon.stub().resolves(""),
    getContentOfUri: sinon.stub().resolves(""),
    getFolderPathForItem: sinon.stub().returns(""),
    getItemOfUri: sinon.stub().resolves(makeItem()),
    getParentOfItem: sinon.stub().resolves(undefined),
    getRootFolder: sinon.stub().returns(undefined),
    getRootItems: sinon.stub().resolves({}),
    getUriOfItem: sinon.stub().resolves(Uri.parse("sasServer:/test")),
    moveItem: sinon.stub().resolves(undefined),
    removeItemFromFavorites: sinon.stub().resolves(false),
    renameItem: sinon.stub().resolves(undefined),
    updateContentOfItem: sinon.stub().resolves(),
    ...overrides,
  } as ContentAdapter;
}

// ============================================================================
// 1. Encoding map tests
// ============================================================================
describe("mapVscodeEncodingToSas", () => {
  it("maps iso88591 → ISO-8859-1", () => {
    expect(mapVscodeEncodingToSas("iso88591")).to.equal("ISO-8859-1");
  });

  it("maps windows1252 → WINDOWS-1252", () => {
    expect(mapVscodeEncodingToSas("windows1252")).to.equal("WINDOWS-1252");
  });

  it("maps utf8 → UTF-8", () => {
    expect(mapVscodeEncodingToSas("utf8")).to.equal("UTF-8");
  });

  it("maps utf8bom → UTF-8", () => {
    expect(mapVscodeEncodingToSas("utf8bom")).to.equal("UTF-8");
  });

  it("maps shiftjis → SHIFT_JIS", () => {
    expect(mapVscodeEncodingToSas("shiftjis")).to.equal("SHIFT_JIS");
  });

  it("maps gbk → GBK", () => {
    expect(mapVscodeEncodingToSas("gbk")).to.equal("GBK");
  });

  it("falls back to .toUpperCase() for unknown encodings", () => {
    expect(mapVscodeEncodingToSas("somecustom")).to.equal("SOMECUSTOM");
  });
});

// ============================================================================
// 2. ContentModel.getContentByUriRaw()
// ============================================================================
describe("ContentModel — getContentByUriRaw", () => {
  it("returns raw bytes when adapter has getContentOfUriRaw", async () => {
    const rawBytes = new Uint8Array([0xc0, 0xe9, 0xf1]);
    const adapter = makeAdapterStub({
      getContentOfUriRaw: sinon.stub().resolves(rawBytes),
    });
    const model = new ContentModel(adapter);

    const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
    const result = await model.getContentByUriRaw(uri);

    expect(result).to.be.instanceOf(Uint8Array);
    expect(result).to.deep.equal(rawBytes);
  });

  it("returns undefined when adapter does NOT have getContentOfUriRaw", async () => {
    const adapter = makeAdapterStub();
    // Ensure no raw method
    delete (adapter as Partial<ContentAdapter>).getContentOfUriRaw;
    const model = new ContentModel(adapter);

    const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
    const result = await model.getContentByUriRaw(uri);

    expect(result).to.be.undefined;
  });
});

// ============================================================================
// 3. ContentModel.saveContentToUri()
// ============================================================================
describe("ContentModel — saveContentToUri", () => {
  it("passes encoding through to updateContentOfItem", async () => {
    const updateStub = sinon.stub().resolves();
    const adapter = makeAdapterStub({ updateContentOfItem: updateStub });
    const model = new ContentModel(adapter);

    const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
    await model.saveContentToUri(uri, "data _null_;", "iso88591");

    expect(updateStub.calledOnce).to.be.true;
    const [passedUri, passedContent, passedEncoding] =
      updateStub.firstCall.args;
    expect(passedUri.path).to.equal(uri.path);
    expect(passedContent).to.equal("data _null_;");
    expect(passedEncoding).to.equal("iso88591");
  });

  it("works without encoding (backward compat)", async () => {
    const updateStub = sinon.stub().resolves();
    const adapter = makeAdapterStub({ updateContentOfItem: updateStub });
    const model = new ContentModel(adapter);

    const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
    await model.saveContentToUri(uri, "data _null_;");

    expect(updateStub.calledOnce).to.be.true;
    const [, , passedEncoding] = updateStub.firstCall.args;
    expect(passedEncoding).to.be.undefined;
  });
});

// ============================================================================
// 4. StudioWebServerAdapter — raw read
// ============================================================================
describe("StudioWebServerAdapter — raw read", () => {
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
    sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("getContentOfItemRaw returns raw Uint8Array from arraybuffer response", async () => {
    const rawBytes = new Uint8Array([0xc0, 0xe9, 0xf1, 0xfc]);
    const arrayBuf = rawBytes.buffer.slice(
      rawBytes.byteOffset,
      rawBytes.byteOffset + rawBytes.byteLength,
    );
    axiosMock.get.resolves({ data: arrayBuf });

    const item = makeItem();
    const result = await adapter.getContentOfItemRaw(item);

    expect(axiosMock.get.calledOnce).to.be.true;
    const [, config] = axiosMock.get.firstCall.args;
    expect(config?.responseType).to.equal("arraybuffer");
    expect(result).to.be.instanceOf(Uint8Array);
    expect(result).to.deep.equal(rawBytes);
  });

  it("getContentOfUriRaw delegates to getContentOfItemRaw", async () => {
    const rawBytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const arrayBuf = rawBytes.buffer.slice(
      rawBytes.byteOffset,
      rawBytes.byteOffset + rawBytes.byteLength,
    );
    axiosMock.get.resolves({ data: arrayBuf });

    const uri = Uri.parse(
      "sasServer:/folders/myfolders/test/file.sas",
    );
    const result = await adapter.getContentOfUriRaw(uri);

    expect(axiosMock.get.calledOnce).to.be.true;
    expect(result).to.be.instanceOf(Uint8Array);
    expect(result).to.deep.equal(rawBytes);
  });
});

// ============================================================================
// 5. StudioWebServerAdapter — write with encoding
// ============================================================================
describe("StudioWebServerAdapter — write with encoding", () => {
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
    sandbox.stub(state, "getEncodeDoubleSlashes").returns(false);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('sends ?encoding=ISO-8859-1 when encoding is "iso88591"', async () => {
    sandbox.stub(state, "getServerEncoding").returns("UTF-8");
    axiosMock.post.resolves({ status: 200 });

    const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
    await adapter.updateContentOfItem(uri, "content", "iso88591");

    expect(axiosMock.post.calledOnce).to.be.true;
    const [, , config] = axiosMock.post.firstCall.args;
    expect(config?.params).to.deep.equal({ encoding: "ISO-8859-1" });
  });

  it("falls back to getServerEncoding() when no encoding arg", async () => {
    sandbox.stub(state, "getServerEncoding").returns("ISO-8859-1");
    axiosMock.post.resolves({ status: 200 });

    const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
    await adapter.updateContentOfItem(uri, "content");

    const [, , config] = axiosMock.post.firstCall.args;
    expect(config?.params).to.deep.equal({ encoding: "ISO-8859-1" });
  });

  it('sends NO encoding param when encoding is "utf8" (server is UTF-8)', async () => {
    sandbox.stub(state, "getServerEncoding").returns("UTF-8");
    axiosMock.post.resolves({ status: 200 });

    const uri = Uri.parse("sasServer:/folders/myfolders/test/file.sas");
    await adapter.updateContentOfItem(uri, "content", "utf8");

    const [, , config] = axiosMock.post.firstCall.args;
    expect(config?.params).to.deep.equal({});
  });
});
