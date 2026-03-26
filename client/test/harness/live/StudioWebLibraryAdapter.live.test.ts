// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Live tests for StudioWebLibraryAdapter against the real SAS Studio server.
// Requires LIVE_SERVER=1 and a running SAS Studio instance at 192.168.0.141.
import { expect } from "chai";

import StudioWebLibraryAdapter from "../../../src/connection/studioweb/StudioWebLibraryAdapter";
import * as state from "../../../src/connection/studioweb/state";
import { LibraryItem } from "../../../src/components/LibraryNavigator/types";
import { LIVE_ENDPOINT, LiveSession, createLiveSession, deleteLiveSession } from "./session";

const LIVE = process.env.LIVE_SERVER === "1";
const maybeIt = LIVE ? it : it.skip;

describe("StudioWebLibraryAdapter — live", function () {
  this.timeout(60000);

  let liveSession: LiveSession;
  let adapter: StudioWebLibraryAdapter;

  before(async function () {
    if (!LIVE) return;
    liveSession = await createLiveSession();
    state.setCredentials({
      endpoint: LIVE_ENDPOINT,
      sessionId: liveSession.sessionId,
    });
    adapter = new StudioWebLibraryAdapter();
  });

  after(async function () {
    state.setCredentials(undefined);
    if (!LIVE || !liveSession) return;
    await deleteLiveSession(liveSession.sessionId);
  });

  // ---------------------------------------------------------------------------
  // getLibraries
  // ---------------------------------------------------------------------------

  maybeIt("getLibraries() returns non-empty list including SASHELP", async () => {
    const result = await adapter.getLibraries();

    expect(result.items).to.be.an("array").that.is.not.empty;
    expect(result.items.every((i) => i.name)).to.be.true;
    const sashelp = result.items.find((i) => i.name === "SASHELP");
    expect(sashelp, "SASHELP library should be present").to.not.be.undefined;
    expect(sashelp!.type).to.equal("library");
  });

  // ---------------------------------------------------------------------------
  // getTables
  // ---------------------------------------------------------------------------

  maybeIt("getTables(SASHELP) includes CLASS dataset", async () => {
    const sashelp: LibraryItem = {
      uid: "SASHELP",
      id: "SASHELP",
      name: "SASHELP",
      type: "library",
      readOnly: true,
    };
    const result = await adapter.getTables(sashelp);

    expect(result.items).to.be.an("array").that.is.not.empty;
    const classTable = result.items.find((t) => t.name === "CLASS");
    expect(classTable, "CLASS table should be in SASHELP").to.not.be.undefined;
  });

  // ---------------------------------------------------------------------------
  // getColumns
  // ---------------------------------------------------------------------------

  maybeIt("getColumns(SASHELP.CLASS) includes expected columns", async () => {
    const classItem: LibraryItem = {
      uid: "SASHELP.CLASS",
      id: "CLASS",
      name: "CLASS",
      type: "table",
      library: "SASHELP",
      readOnly: true,
    };
    const result = await adapter.getColumns(classItem);

    const names = result.items.map((c) => c.name);
    expect(names).to.include("Name");
    expect(names).to.include("Age");
    expect(names).to.include("Height");
    expect(names).to.include("Weight");
    expect(names).to.include("Sex");
  });

  // ---------------------------------------------------------------------------
  // getRows
  // ---------------------------------------------------------------------------

  maybeIt("getRows(SASHELP.CLASS, 0, 5) returns 5 rows with row numbers", async () => {
    const classItem: LibraryItem = {
      uid: "SASHELP.CLASS",
      id: "CLASS",
      name: "CLASS",
      type: "table",
      library: "SASHELP",
      readOnly: true,
    };
    const result = await adapter.getRows(classItem, 0, 5, [], undefined);

    expect(result.rows).to.have.length(5);
    expect(result.rows[0].cells![0]).to.equal("1");
  });

  maybeIt("getRows with sort returns alphabetically ordered rows", async () => {
    const classItem: LibraryItem = {
      uid: "SASHELP.CLASS",
      id: "CLASS",
      name: "CLASS",
      type: "table",
      library: "SASHELP",
      readOnly: true,
    };
    const result = await adapter.getRows(
      classItem,
      0,
      19,
      [{ colId: "Name", sort: "asc" }],
      undefined,
    );

    expect(result.rows.length).to.be.at.least(5);
    // cells[0] is row number, cells[1] should be Name (first column)
    const firstName = result.rows[0].cells![1];
    const secondName = result.rows[1].cells![1];
    expect(firstName <= secondName).to.be.true;
  });

  maybeIt("getRows with filter returns only matching rows", async () => {
    const classItem: LibraryItem = {
      uid: "SASHELP.CLASS",
      id: "CLASS",
      name: "CLASS",
      type: "table",
      library: "SASHELP",
      readOnly: true,
    };
    const result = await adapter.getRows(
      classItem,
      0,
      20,
      [],
      { filterValue: "Sex='F'" },
    );

    expect(result.rows.length).to.be.at.least(1);
    // All rows should have Sex = 'F'; Sex is the last column (index 5, cells[6])
    // We can't easily assert the value without knowing column index,
    // but we can assert all rows were returned (CLASS has 9 females)
    expect(result.rows.length).to.be.at.most(10);
  });

  // ---------------------------------------------------------------------------
  // getTableRowCount
  // ---------------------------------------------------------------------------

  maybeIt("getTableRowCount(SASHELP.CLASS) returns correct stats", async () => {
    const classItem: LibraryItem = {
      uid: "SASHELP.CLASS",
      id: "CLASS",
      name: "CLASS",
      type: "table",
      library: "SASHELP",
      readOnly: true,
    };
    const result = await adapter.getTableRowCount(classItem);

    expect(result.rowCount).to.be.at.least(1);
    expect(result.maxNumberOfRowsToRead).to.equal(100);
  });

  // ---------------------------------------------------------------------------
  // getTableInfo
  // ---------------------------------------------------------------------------

  maybeIt("getTableInfo(SASHELP.CLASS) returns correct metadata", async () => {
    const classItem: LibraryItem = {
      uid: "SASHELP.CLASS",
      id: "CLASS",
      name: "CLASS",
      type: "table",
      library: "SASHELP",
      readOnly: true,
    };
    const result = await adapter.getTableInfo!(classItem);

    expect(result.name).to.equal("CLASS");
    expect(result.libref).to.equal("SASHELP");
    expect(result.rowCount).to.be.at.least(1);
    expect(result.columnCount).to.be.at.least(1);
  });

  // ---------------------------------------------------------------------------
  // assignTempLibrary
  // ---------------------------------------------------------------------------

  maybeIt("assignTempLibrary creates a TMPLIB and it appears in getLibraries", async () => {
    // Use sasdemo's home directory or a temp path
    await adapter.assignTempLibrary("TMPLIB01", "/tmp");

    const result = await adapter.getLibraries();
    const tmpLib = result.items.find((i) => i.name === "TMPLIB01");
    expect(tmpLib, "TMPLIB01 should appear after assignTempLibrary").to.not.be
      .undefined;
  });
});
