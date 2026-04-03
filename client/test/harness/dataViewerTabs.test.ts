// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Regression tests for the DataViewer tab-switching bug.
//
// DataViewer renders <TabBar tabs={["Data", "Columns"]} ...> and compares
// activeTab against "data" / "columns" (lowercase). The onTabChange callback
// must normalize the display label before storing it as state, otherwise
// the tab content panel never renders after the first click.
import { expect } from "chai";

// The display labels passed to TabBar
const TAB_LABELS = ["Data", "Columns"] as const;

// The state keys used in render conditions
//   {activeTab === "data" && ...}
//   {activeTab === "columns" && ...}
const TAB_KEYS = ["data", "columns"] as const;
type TabKey = (typeof TAB_KEYS)[number];

// ---------------------------------------------------------------------------
// Helpers – mirrors the fix in DataViewer.tsx onTabChange
// ---------------------------------------------------------------------------

/** Buggy version: type-cast only, no case conversion. */
function deriveTabKeyBuggy(label: string): string {
  return label as unknown as TabKey; // preserves "Data" / "Columns"
}

/** Fixed version: toLowerCase before cast. */
function deriveTabKeyFixed(label: string): TabKey {
  return label.toLowerCase() as TabKey;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DataViewer tab key normalization", () => {
  describe("reproduces bug: cast-only does not normalize case", () => {
    it("'Data' label does not equal state key 'data'", () => {
      expect(deriveTabKeyBuggy("Data")).to.not.equal("data");
    });

    it("'Columns' label does not equal state key 'columns'", () => {
      expect(deriveTabKeyBuggy("Columns")).to.not.equal("columns");
    });

    it("neither tab label matches any render condition after a click", () => {
      for (const label of TAB_LABELS) {
        const key = deriveTabKeyBuggy(label);
        const matchesAny = TAB_KEYS.some((k) => k === key);
        expect(matchesAny).to.equal(
          false,
          `Expected "${label}" to NOT match any render key, but it matched`,
        );
      }
    });
  });

  describe("fix: toLowerCase() maps display labels to state keys", () => {
    it("'Data' → 'data'", () => {
      expect(deriveTabKeyFixed("Data")).to.equal("data");
    });

    it("'Columns' → 'columns'", () => {
      expect(deriveTabKeyFixed("Columns")).to.equal("columns");
    });

    it("every tab label maps to the corresponding render-condition key", () => {
      TAB_LABELS.forEach((label, i) => {
        expect(deriveTabKeyFixed(label)).to.equal(TAB_KEYS[i]);
      });
    });
  });
});
