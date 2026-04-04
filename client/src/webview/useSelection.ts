// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useState } from "react";

import { GridApi } from "ag-grid-community";

export interface SelectionState {
  anchor: { row: number; col: string } | null;
  end: { row: number; col: string } | null;
  mode: "cell" | "row" | "column" | "range" | null;
}

export function getColumnRange(
  startCol: string,
  endCol: string,
  allColumns: string[],
): string[] {
  const startIdx = allColumns.indexOf(startCol);
  const endIdx = allColumns.indexOf(endCol);
  if (startIdx === -1 || endIdx === -1) {
    return [];
  }
  const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  return allColumns.slice(lo, hi + 1);
}

export function getRowRange(
  startRow: number,
  endRow: number,
): [number, number] {
  return startRow <= endRow ? [startRow, endRow] : [endRow, startRow];
}

export function isCellSelected(
  state: SelectionState,
  row: number,
  col: string,
  allColumns: string[],
): boolean {
  if (!state.anchor || !state.end || !state.mode) {
    return false;
  }

  if (state.mode === "row") {
    const [rowStart, rowEnd] = getRowRange(state.anchor.row, state.end.row);
    const dataCols = allColumns.filter((c) => c !== "#");
    return row >= rowStart && row <= rowEnd && dataCols.includes(col);
  }

  if (state.mode === "column") {
    const colRange = getColumnRange(
      state.anchor.col,
      state.end.col,
      allColumns,
    );
    return colRange.includes(col);
  }

  const [rowStart, rowEnd] = getRowRange(state.anchor.row, state.end.row);
  const colRange = getColumnRange(state.anchor.col, state.end.col, allColumns);

  return row >= rowStart && row <= rowEnd && colRange.includes(col);
}

export function csvQuote(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function getSelectedDataAsCSV(
  state: SelectionState,
  api: GridApi,
  allColumns: string[],
): string {
  if (!state.anchor || !state.end || !state.mode) {
    return "";
  }

  let rowStart: number;
  let rowEnd: number;
  if (state.mode === "column") {
    rowStart = 0;
    rowEnd = api.getDisplayedRowCount() - 1;
  } else {
    [rowStart, rowEnd] = getRowRange(state.anchor.row, state.end.row);
  }

  let cols: string[];
  if (state.mode === "row") {
    cols = allColumns.filter((c) => c !== "#");
  } else {
    cols = getColumnRange(state.anchor.col, state.end.col, allColumns);
  }

  const lines: string[] = [];

  lines.push(cols.map(csvQuote).join(","));

  for (let r = rowStart; r <= rowEnd; r++) {
    const rowNode = api.getDisplayedRowAtIndex(r);
    if (!rowNode?.data) {
      continue;
    }
    lines.push(cols.map((col) => csvQuote(rowNode.data[col] ?? "")).join(","));
  }

  return lines.join("\n");
}

interface UseSelectionReturn {
  selection: SelectionState;
  selectCell: (row: number, col: string, shiftKey: boolean) => void;
  selectRow: (row: number, shiftKey?: boolean) => void;
  selectColumn: (col: string, shiftKey: boolean) => void;
  selectAll: (lastRow: number, allDataColumns: string[]) => void;
  clearSelection: () => void;
  hasSelection: () => boolean;
  isCellSelected: (row: number, col: string) => boolean;
}

export default function useSelection(
  allColumns: () => string[],
): UseSelectionReturn {
  const [selection, setSelection] = useState<SelectionState>({
    anchor: null,
    end: null,
    mode: null,
  });

  const selectCell = useCallback(
    (row: number, col: string, shiftKey: boolean) => {
      setSelection((prev: SelectionState) => {
        if (shiftKey && prev.anchor && prev.mode) {
          return {
            anchor: prev.anchor,
            end: { row, col },
            mode: "range",
          };
        }
        return {
          anchor: { row, col },
          end: { row, col },
          mode: "cell",
        };
      });
    },
    [],
  );

  const selectRow = useCallback((row: number, shiftKey: boolean = false) => {
    setSelection((prev: SelectionState) => {
      if (shiftKey && prev.mode === "row" && prev.anchor) {
        return {
          anchor: prev.anchor,
          end: { row, col: "#" },
          mode: "row",
        };
      }
      return {
        anchor: { row, col: "#" },
        end: { row, col: "#" },
        mode: "row",
      };
    });
  }, []);

  const selectColumn = useCallback((col: string, shiftKey: boolean) => {
    setSelection((prev: SelectionState) => {
      if (shiftKey && prev.anchor && prev.mode === "column") {
        return {
          anchor: prev.anchor,
          end: { row: -1, col },
          mode: "column",
        };
      }
      return {
        anchor: { row: -1, col },
        end: { row: -1, col },
        mode: "column",
      };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({
      anchor: null,
      end: null,
      mode: null,
    });
  }, []);

  const selectAll = useCallback((lastRow: number, allDataColumns: string[]) => {
    if (allDataColumns.length === 0 || lastRow < 0) {
      return;
    }
    setSelection({
      anchor: { row: 0, col: allDataColumns[0] },
      end: { row: lastRow, col: allDataColumns[allDataColumns.length - 1] },
      mode: "range",
    });
  }, []);

  const hasSelection = useCallback(() => {
    return selection.anchor !== null && selection.end !== null;
  }, [selection]);

  const isCellSelectedBound = useCallback(
    (row: number, col: string) => {
      return isCellSelected(selection, row, col, allColumns());
    },
    [selection, allColumns],
  );

  return {
    selection,
    selectCell,
    selectRow,
    selectColumn,
    selectAll,
    clearSelection,
    hasSelection,
    isCellSelected: isCellSelectedBound,
  };
}
