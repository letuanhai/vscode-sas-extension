// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tests for StudioWebLibraryAdapter — all adapter methods, zero server needed.
import { expect } from "chai";
import * as sinon from "sinon";

import StudioWebLibraryAdapter from "../../src/connection/studioweb/StudioWebLibraryAdapter";
import * as studiwebIndex from "../../src/connection/studioweb/index";
import * as state from "../../src/connection/studioweb/state";
import { LibraryItem } from "../../src/components/LibraryNavigator/types";

const SESSION_ID = "test-lib-session";

const makeAxiosMock = () => ({
  get: sinon.stub(),
  post: sinon.stub(),
  put: sinon.stub(),
  delete: sinon.stub(),
  defaults: { baseURL: "http://sas.test/sasexec" },
});

const makeLibItem = (overrides: Partial<LibraryItem> = {}): LibraryItem => ({
  uid: "SASHELP",
  id: "SASHELP",
  name: "SASHELP",
  type: "library",
  readOnly: true,
  ...overrides,
});

const makeTableItem = (overrides: Partial<LibraryItem> = {}): LibraryItem => ({
  uid: "SASHELP.CLASS",
  id: "CLASS",
  name: "CLASS",
  type: "table",
  library: "SASHELP",
  readOnly: true,
  ...overrides,
});

describe("StudioWebLibraryAdapter", () => {
  let sandbox: sinon.SinonSandbox;
  let adapter: StudioWebLibraryAdapter;
  let axiosMock: ReturnType<typeof makeAxiosMock>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    adapter = new StudioWebLibraryAdapter();
    axiosMock = makeAxiosMock();

    sandbox.stub(studiwebIndex, "ensureCredentials").resolves(true);
    sandbox.stub(state, "getAxios").returns(axiosMock as never);
    sandbox.stub(state, "getCredentials").returns({
      endpoint: "http://sas.test",
      sessionId: SESSION_ID,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // getLibraries
  // ---------------------------------------------------------------------------
  describe("getLibraries()", () => {
    it("maps children array to LibraryItem[]", async () => {
      axiosMock.get.resolves({
        data: {
          children: [
            { name: "SASHELP", readOnly: true },
            { name: "WORK", readOnly: false },
          ],
        },
      });

      const result = await adapter.getLibraries();

      expect(result.items).to.have.length(2);
      expect(result.items[0].name).to.equal("SASHELP");
      expect(result.items[0].type).to.equal("library");
      expect(result.items[0].readOnly).to.equal(true);
      expect(result.items[1].name).to.equal("WORK");
      expect(result.items[1].readOnly).to.equal(false);
    });

    it("parses readOnly as true when value is string 'yes'", async () => {
      axiosMock.get.resolves({
        data: {
          children: [{ name: "MYLIB", readOnly: "yes" }],
        },
      });

      const result = await adapter.getLibraries();

      expect(result.items[0].readOnly).to.equal(true);
    });

    it("parses readOnly as false when value is string 'no'", async () => {
      axiosMock.get.resolves({
        data: {
          children: [{ name: "MYLIB", readOnly: "no" }],
        },
      });

      const result = await adapter.getLibraries();

      expect(result.items[0].readOnly).to.equal(false);
    });

    it("handles bare array response (no children wrapper)", async () => {
      axiosMock.get.resolves({
        data: [{ name: "SASHELP", readOnly: false }],
      });

      const result = await adapter.getLibraries();

      expect(result.items).to.have.length(1);
      expect(result.items[0].name).to.equal("SASHELP");
    });

    it("returns empty items on HTTP error", async () => {
      axiosMock.get.rejects(new Error("Network error"));

      const result = await adapter.getLibraries();

      expect(result.items).to.have.length(0);
      expect(result.count).to.equal(0);
    });

    it("GETs the correct URL with sessionId", async () => {
      axiosMock.get.resolves({ data: { children: [] } });

      await adapter.getLibraries();

      expect(axiosMock.get.calledOnce).to.be.true;
      const url: string = axiosMock.get.firstCall.args[0];
      expect(url).to.equal(`/libdata/${SESSION_ID}/libraries`);
    });
  });

  // ---------------------------------------------------------------------------
  // getTables
  // ---------------------------------------------------------------------------
  describe("getTables()", () => {
    it("maps children to LibraryItem[] with library field", async () => {
      axiosMock.get.resolves({
        data: {
          children: [
            { name: "CLASS", type: "DATA" },
            { name: "CARS", type: "DATA" },
          ],
        },
      });

      const lib = makeLibItem();
      const result = await adapter.getTables(lib);

      expect(result.items).to.have.length(2);
      expect(result.items[0].library).to.equal("SASHELP");
      expect(result.items[0].type).to.equal("table");
    });

    it("detects VIEW type from entry.type", async () => {
      axiosMock.get.resolves({
        data: {
          children: [{ name: "VCLASS", type: "VIEW" }],
        },
      });

      const lib = makeLibItem();
      const result = await adapter.getTables(lib);

      expect(result.items[0].type).to.equal("view");
    });

    it("detects VIEW type from entry.member", async () => {
      axiosMock.get.resolves({
        data: {
          children: [{ name: "VCLASS", member: "VIEW" }],
        },
      });

      const lib = makeLibItem();
      const result = await adapter.getTables(lib);

      expect(result.items[0].type).to.equal("view");
    });

    it("returns empty items on error", async () => {
      axiosMock.get.rejects(new Error("error"));

      const result = await adapter.getTables(makeLibItem());

      expect(result.items).to.have.length(0);
      expect(result.count).to.equal(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getColumns
  // ---------------------------------------------------------------------------
  describe("getColumns()", () => {
    it("maps items array to columns with type, length, format", async () => {
      axiosMock.post.resolves({
        data: {
          items: [
            { name: "Name", type: "char", length: 8, format: "BEST." },
            { name: "Age", type: "num", length: 8, format: { name: "BEST8." } },
          ],
        },
      });

      const result = await adapter.getColumns(makeTableItem());

      expect(result.items).to.have.length(2);
      expect(result.items[0].name).to.equal("Name");
      expect(result.items[0].type).to.equal("char");
      expect(result.items[0].length).to.equal(8);
      expect(result.items[1].name).to.equal("Age");
      expect(result.items[1].format).to.deep.equal({ name: "BEST8." });
    });

    it("falls back to columns key if items is absent", async () => {
      axiosMock.post.resolves({
        data: {
          columns: [{ name: "X", type: "num", length: 8 }],
        },
      });

      const result = await adapter.getColumns(makeTableItem());

      expect(result.items).to.have.length(1);
      expect(result.items[0].name).to.equal("X");
    });

    it("returns empty items on error", async () => {
      axiosMock.post.rejects(new Error("error"));

      const result = await adapter.getColumns(makeTableItem());

      expect(result.items).to.have.length(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getRows
  // ---------------------------------------------------------------------------
  describe("getRows()", () => {
    it("builds correct SQL for simple query", async () => {
      axiosMock.post.resolves({ data: { rows: [] } });

      await adapter.getRows(makeTableItem(), 0, 20, [], undefined);

      const body: string = axiosMock.post.firstCall.args[1];
      expect(body).to.include("select * from SASHELP.'CLASS'n");
      const params = axiosMock.post.firstCall.args[2]?.params;
      expect(params).to.deep.equal({ firstobs: 1, numobs: 20 });
    });

    it("builds WHERE clause from filterValue", async () => {
      axiosMock.post.resolves({ data: { rows: [] } });

      await adapter.getRows(
        makeTableItem(),
        0,
        20,
        [],
        { filterValue: "Sex='F'" },
      );

      const body: string = axiosMock.post.firstCall.args[1];
      expect(body).to.include("where (Sex='F')");
    });

    it("builds ORDER BY clause from sortModel", async () => {
      axiosMock.post.resolves({ data: { rows: [] } });

      await adapter.getRows(
        makeTableItem(),
        0,
        20,
        [{ colId: "Name", sort: "asc" }],
        undefined,
      );

      const body: string = axiosMock.post.firstCall.args[1];
      expect(body).to.include("order by Name asc");
    });

    it("sets count=-1 when row count equals limit (more pages available)", async () => {
      const rawRows = Array.from({ length: 20 }, (_, i) => [`${i}`]);
      axiosMock.post.resolves({ data: { rows: rawRows } });

      const result = await adapter.getRows(makeTableItem(), 0, 20, [], undefined);

      expect(result.count).to.equal(-1);
    });

    it("sets count to start+rows.length when fewer rows returned (last page)", async () => {
      const rawRows = [["Alice", "13"], ["Bob", "14"]];
      axiosMock.post.resolves({ data: { rows: rawRows } });

      const result = await adapter.getRows(makeTableItem(), 10, 20, [], undefined);

      expect(result.count).to.equal(12); // 10 + 2
    });

    it("prepends row number as cells[0]", async () => {
      axiosMock.post.resolves({
        data: { rows: [["Alice", "13"], ["Bob", "14"]] },
      });

      const result = await adapter.getRows(makeTableItem(), 0, 20, [], undefined);

      expect(result.rows[0].cells![0]).to.equal("1");
      expect(result.rows[1].cells![0]).to.equal("2");
    });

    it("offset shifts row number index", async () => {
      axiosMock.post.resolves({
        data: { rows: [["Alice", "13"]] },
      });

      const result = await adapter.getRows(makeTableItem(), 5, 20, [], undefined);

      // start=5 so row numbers start at 6
      expect(result.rows[0].cells![0]).to.equal("6");
    });
  });

  // ---------------------------------------------------------------------------
  // getTableRowCount
  // ---------------------------------------------------------------------------
  describe("getTableRowCount()", () => {
    it("returns rowCount and columnCount from server response", async () => {
      axiosMock.post.resolves({
        data: { numRows: 100, numColumns: 5 },
      });

      const result = await adapter.getTableRowCount(makeTableItem());

      expect(result.rowCount).to.equal(100);
      expect(result.columnCount).to.equal(5);
      expect(result.maxNumberOfRowsToRead).to.equal(100);
    });

    it("returns rowCount=0 on error", async () => {
      axiosMock.post.rejects(new Error("error"));

      const result = await adapter.getTableRowCount(makeTableItem());

      expect(result.rowCount).to.equal(0);
      expect(result.maxNumberOfRowsToRead).to.equal(100);
    });
  });

  // ---------------------------------------------------------------------------
  // getTableInfo
  // ---------------------------------------------------------------------------
  describe("getTableInfo()", () => {
    it("maps all fields from server response", async () => {
      const createDate = 1700000000000;
      const modifiedDate = 1700001000000;

      axiosMock.post.resolves({
        data: {
          name: "CLASS",
          library: "SASHELP",
          dataType: "DATA",
          desc: "Class dataset",
          engine: "BASE",
          id: "SASHELP.CLASS",
          numRows: 19,
          numColumns: 5,
          createDate,
          modifiedDate,
        },
      });

      const result = await adapter.getTableInfo!(makeTableItem());

      expect(result.name).to.equal("CLASS");
      expect(result.libref).to.equal("SASHELP");
      expect(result.type).to.equal("DATA");
      expect(result.label).to.equal("Class dataset");
      expect(result.engine).to.equal("BASE");
      expect(result.rowCount).to.equal(19);
      expect(result.columnCount).to.equal(5);
      expect(result.creationTimeStamp).to.equal(
        new Date(createDate).toISOString(),
      );
      expect(result.modifiedTimeStamp).to.equal(
        new Date(modifiedDate).toISOString(),
      );
    });

    it("returns minimal {name, libref} on error", async () => {
      axiosMock.post.rejects(new Error("error"));

      const item = makeTableItem();
      const result = await adapter.getTableInfo!(item);

      expect(result.name).to.equal(item.name);
      expect(result.libref).to.equal(item.library);
    });
  });

  // ---------------------------------------------------------------------------
  // assignTempLibrary
  // ---------------------------------------------------------------------------
  describe("assignTempLibrary()", () => {
    it("PUTs to the correct URL with required fields", async () => {
      axiosMock.put.resolves({ status: 200 });

      await adapter.assignTempLibrary("TMPLIB", "/home/user/mydata");

      expect(axiosMock.put.calledOnce).to.be.true;
      const [url, body] = axiosMock.put.firstCall.args;
      expect(url).to.equal(`/libdata/${SESSION_ID}/TMPLIB`);
      expect(body.isLibrary).to.equal(true);
      expect(body.path).to.equal("/home/user/mydata");
      expect(body.name).to.equal("TMPLIB");
      expect(body.id).to.equal("TMPLIB");
    });
  });

  // ---------------------------------------------------------------------------
  // pollUntilComplete (via deleteTable)
  // ---------------------------------------------------------------------------
  describe("pollUntilComplete() — tested via deleteTable()", () => {
    it("exits on SubmitComplete message", async () => {
      // POST to submit
      axiosMock.post.resolves({ data: "del-sub-001" });
      // Longpoll returns SubmitComplete
      axiosMock.get.resolves({
        data: [{ type: "SubmitComplete" }],
      });

      const item = makeTableItem();
      await adapter.deleteTable(item);

      expect(axiosMock.get.calledOnce).to.be.true;
    });

    it("exits on empty array response", async () => {
      axiosMock.post.resolves({ data: "del-sub-002" });
      axiosMock.get.resolves({ data: [] });

      await adapter.deleteTable(makeTableItem());

      expect(axiosMock.get.calledOnce).to.be.true;
    });

    it("continues polling on non-terminal messages", async () => {
      axiosMock.post.resolves({ data: "del-sub-003" });
      axiosMock.get
        .onFirstCall()
        .resolves({ data: [{ type: "LogChunk" }] })
        .onSecondCall()
        .resolves({ data: [{ type: "SubmitComplete" }] });

      await adapter.deleteTable(makeTableItem());

      expect(axiosMock.get.callCount).to.equal(2);
    });
  });
});
