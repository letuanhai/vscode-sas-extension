// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  SelectionState,
  csvQuote,
  getColumnRange,
  getRowRange,
  getSelectedDataAsCSV,
  isCellSelected,
} from "../../src/webview/useSelection";

describe("getColumnRange", () => {
  const cols = ["#", "Make", "Model", "MSRP", "Invoice", "Weight"];

  it("returns single column when start === end", () => {
    expect(getColumnRange("MSRP", "MSRP", cols)).to.deep.equal(["MSRP"]);
  });

  it("returns range in forward order", () => {
    expect(getColumnRange("Make", "MSRP", cols)).to.deep.equal([
      "Make",
      "Model",
      "MSRP",
    ]);
  });

  it("returns range in reverse order (auto-swaps)", () => {
    expect(getColumnRange("MSRP", "Make", cols)).to.deep.equal([
      "Make",
      "Model",
      "MSRP",
    ]);
  });

  it("returns empty array when column not found", () => {
    expect(getColumnRange("NotExist", "Make", cols)).to.deep.equal([]);
  });
});

describe("getRowRange", () => {
  it("returns [start, end] when start <= end", () => {
    expect(getRowRange(2, 5)).to.deep.equal([2, 5]);
  });

  it("swaps when start > end", () => {
    expect(getRowRange(5, 2)).to.deep.equal([2, 5]);
  });

  it("works with identical indices", () => {
    expect(getRowRange(3, 3)).to.deep.equal([3, 3]);
  });
});

describe("isCellSelected", () => {
  const cols = ["#", "Make", "Model", "MSRP", "Invoice"];

  it("returns true for a single-cell selection", () => {
    const state: SelectionState = {
      anchor: { row: 2, col: "MSRP" },
      end: { row: 2, col: "MSRP" },
      mode: "cell",
    };
    expect(isCellSelected(state, 2, "MSRP", cols)).to.be.true;
  });

  it("returns false for cell outside selection", () => {
    const state: SelectionState = {
      anchor: { row: 2, col: "MSRP" },
      end: { row: 2, col: "MSRP" },
      mode: "cell",
    };
    expect(isCellSelected(state, 3, "MSRP", cols)).to.be.false;
  });

  it("returns true for cell within a rectangular range", () => {
    const state: SelectionState = {
      anchor: { row: 1, col: "Make" },
      end: { row: 3, col: "MSRP" },
      mode: "range",
    };
    expect(isCellSelected(state, 2, "Model", cols)).to.be.true;
  });

  it("returns true for all data columns in row mode", () => {
    const state: SelectionState = {
      anchor: { row: 2, col: "#" },
      end: { row: 2, col: "#" },
      mode: "row",
    };
    expect(isCellSelected(state, 2, "Make", cols)).to.be.true;
    expect(isCellSelected(state, 2, "Invoice", cols)).to.be.true;
  });

  it("returns false for different row in row mode", () => {
    const state: SelectionState = {
      anchor: { row: 2, col: "#" },
      end: { row: 2, col: "#" },
      mode: "row",
    };
    expect(isCellSelected(state, 3, "Make", cols)).to.be.false;
  });

  it("returns true for all rows in column mode", () => {
    const state: SelectionState = {
      anchor: { row: 0, col: "MSRP" },
      end: { row: 999, col: "MSRP" },
      mode: "column",
    };
    expect(isCellSelected(state, 50, "MSRP", cols)).to.be.true;
  });

  it("returns false when selection is null", () => {
    const state: SelectionState = { anchor: null, end: null, mode: null };
    expect(isCellSelected(state, 0, "Make", cols)).to.be.false;
  });
});

describe("csvQuote", () => {
  it("returns plain value when no special characters", () => {
    expect(csvQuote("hello")).to.equal("hello");
  });

  it("wraps in double quotes when value contains comma", () => {
    expect(csvQuote("a,b")).to.equal('"a,b"');
  });

  it("wraps and escapes embedded double quotes", () => {
    expect(csvQuote('say "hi"')).to.equal('"say ""hi"""');
  });

  it("wraps when value contains newline", () => {
    expect(csvQuote("line1\nline2")).to.equal('"line1\nline2"');
  });

  it("handles empty string", () => {
    expect(csvQuote("")).to.equal("");
  });
});

describe("getSelectedDataAsCSV", () => {
  const makeApi = (data: Record<string, string>[]) => ({
    getDisplayedRowAtIndex: (i: number) =>
      i < data.length ? { data: data[i] } : null,
  });

  const allColumns = ["#", "Make", "Model", "MSRP"];

  it("single cell: returns header + one value", () => {
    const api = makeApi([
      { "#": "1", Make: "Acura", Model: "MDX", MSRP: "36945" },
    ]);
    const state: SelectionState = {
      anchor: { row: 0, col: "Make" },
      end: { row: 0, col: "Make" },
      mode: "cell",
    };
    const csv = getSelectedDataAsCSV(
      state,
      api as unknown as Parameters<typeof getSelectedDataAsCSV>[1],
      allColumns,
    );
    expect(csv).to.equal("Make\nAcura");
  });

  it("range: returns header + rectangular data", () => {
    const api = makeApi([
      { "#": "1", Make: "Acura", Model: "MDX", MSRP: "36945" },
      { "#": "2", Make: "BMW", Model: "X5", MSRP: "54200" },
    ]);
    const state: SelectionState = {
      anchor: { row: 0, col: "Make" },
      end: { row: 1, col: "Model" },
      mode: "range",
    };
    const csv = getSelectedDataAsCSV(
      state,
      api as unknown as Parameters<typeof getSelectedDataAsCSV>[1],
      allColumns,
    );
    expect(csv).to.equal("Make,Model\nAcura,MDX\nBMW,X5");
  });

  it("row mode: includes all data columns (excludes '#')", () => {
    const api = makeApi([
      { "#": "1", Make: "Acura", Model: "MDX", MSRP: "36945" },
    ]);
    const state: SelectionState = {
      anchor: { row: 0, col: "#" },
      end: { row: 0, col: "#" },
      mode: "row",
    };
    const csv = getSelectedDataAsCSV(
      state,
      api as unknown as Parameters<typeof getSelectedDataAsCSV>[1],
      allColumns,
    );
    expect(csv).to.equal("Make,Model,MSRP\nAcura,MDX,36945");
  });

  it("skips rows with no data (not loaded)", () => {
    const api = makeApi([
      { "#": "1", Make: "Acura", Model: "MDX", MSRP: "36945" },
    ]);
    const state: SelectionState = {
      anchor: { row: 0, col: "Make" },
      end: { row: 2, col: "Make" },
      mode: "range",
    };
    const csv = getSelectedDataAsCSV(
      state,
      api as unknown as Parameters<typeof getSelectedDataAsCSV>[1],
      allColumns,
    );
    expect(csv).to.equal("Make\nAcura");
  });

  it("quotes values containing commas", () => {
    const api = makeApi([
      { "#": "1", Make: "Acura", Model: "RSX Type S, 2dr", MSRP: "23820" },
    ]);
    const state: SelectionState = {
      anchor: { row: 0, col: "Model" },
      end: { row: 0, col: "Model" },
      mode: "cell",
    };
    const csv = getSelectedDataAsCSV(
      state,
      api as unknown as Parameters<typeof getSelectedDataAsCSV>[1],
      allColumns,
    );
    expect(csv).to.equal('Model\n"RSX Type S, 2dr"');
  });
});
