// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the pure helper functions in ColumnManager.tsx.
// Because that module uses React/webview dependencies, we duplicate the pure
// filtering and visibility logic here and keep it in sync.
import { expect } from "chai";

import { Column } from "../../src/connection/rest/api/compute";

// ---------------------------------------------------------------------------
// Duplicated from client/src/webview/ColumnManager.tsx
// Keep in sync with the source implementation.
// ---------------------------------------------------------------------------

function filterColumns(columns: Column[], query: string): Column[] {
  if (!query) {
    return columns;
  }
  const search = query.toLowerCase();
  return columns.filter((col) => {
    const name = (col.name || "").toLowerCase();
    const label = (col.label || "").toLowerCase();
    return name.includes(search) || label.includes(search);
  });
}

function selectAllColumns(
  visible: Set<string>,
  allColumnNames: string[],
): Set<string> {
  return new Set(allColumnNames);
}

function deselectAllColumns(
  visible: Set<string>,
  allColumnNames: string[],
): Set<string> {
  return new Set<string>();
}

function invertSelection(
  hiddenColumns: Set<string>,
  allColumnNames: string[],
): Set<string> {
  const result = new Set<string>();
  allColumnNames.forEach((name) => {
    if (!hiddenColumns.has(name)) {
      // Was visible, becomes hidden (add to hidden set)
      result.add(name);
    }
    // Was hidden, becomes visible (not in hidden set)
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests for column search filtering
// ---------------------------------------------------------------------------

describe("filterColumns (ColumnManager)", () => {
  const columns: Column[] = [
    { name: "Make", type: "char", length: 13, label: "" },
    { name: "Model", type: "char", length: 40, label: "Vehicle Model" },
    { name: "MSRP", type: "num", length: 8, label: "Retail Price" },
    { name: "Invoice", type: "num", length: 8, label: "" },
    { name: "EngineSize", type: "num", length: 8, label: "Engine Size (L)" },
  ];

  it("returns all columns with empty query", () => {
    expect(filterColumns(columns, "")).to.have.length(5);
  });

  it("filters by name (case-insensitive)", () => {
    const result = filterColumns(columns, "msrp");
    expect(result).to.have.length(1);
    expect(result[0].name).to.equal("MSRP");
  });

  it("filters by partial name match", () => {
    const result = filterColumns(columns, "m");
    expect(result.map((c) => c.name)).to.include.members([
      "Make",
      "Model",
      "MSRP",
    ]);
  });

  it("filters by label", () => {
    const result = filterColumns(columns, "retail");
    expect(result).to.have.length(1);
    expect(result[0].name).to.equal("MSRP");
  });

  it("returns empty for no matches", () => {
    expect(filterColumns(columns, "xyz")).to.have.length(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for bulk visibility operations
// ---------------------------------------------------------------------------

describe("column visibility helpers", () => {
  const allCols = ["Make", "Model", "MSRP", "Invoice", "Weight"];

  describe("selectAllColumns", () => {
    it("returns set with all columns", () => {
      const visible = new Set(["Make"]);
      const result = selectAllColumns(visible, allCols);
      expect([...result]).to.deep.equal(allCols);
    });

    it("works even when visible is empty", () => {
      const visible = new Set<string>();
      const result = selectAllColumns(visible, allCols);
      expect([...result]).to.deep.equal(allCols);
    });
  });

  describe("deselectAllColumns", () => {
    it("returns empty set", () => {
      const visible = new Set(allCols);
      const result = deselectAllColumns(visible, allCols);
      expect(result.size).to.equal(0);
    });

    it("returns empty set even when already empty", () => {
      const visible = new Set<string>();
      const result = deselectAllColumns(visible, allCols);
      expect(result.size).to.equal(0);
    });
  });

  describe("invertSelection", () => {
    it("flips each column visibility", () => {
      const hiddenColumns = new Set(["Make", "MSRP"]);
      const result = invertSelection(hiddenColumns, allCols);
      expect([...result].sort()).to.deep.equal(["Invoice", "Model", "Weight"]);
    });

    it("returns empty set when all columns are hidden", () => {
      const hiddenColumns = new Set(allCols);
      const result = invertSelection(hiddenColumns, allCols);
      expect(result.size).to.equal(0);
    });

    it("returns all columns when none are hidden", () => {
      const hiddenColumns = new Set<string>();
      const result = invertSelection(hiddenColumns, allCols);
      expect([...result].sort()).to.deep.equal(allCols.sort());
    });
  });
});
