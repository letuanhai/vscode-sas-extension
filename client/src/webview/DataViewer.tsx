// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { CellClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

import ".";
import ColumnManager from "./ColumnManager";
import ColumnMenu from "./ColumnMenu";
import TabBar from "./TabBar";
import TableFilter from "./TableFilter";
import localize from "./localize";
import useDataViewer from "./useDataViewer";
import useSelection, { getSelectedDataAsCSV } from "./useSelection";
import useTheme from "./useTheme";

import "./DataViewer.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

const gridStyles = {
  "--ag-borders": "none",
  "--ag-row-border-width": "0px",
  flex: "1",
  width: "100%",
  minHeight: 0,
};

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
const copyHintKey = isMac ? "Cmd+C" : "Ctrl+C";

const DataViewer = () => {
  const title = document
    .querySelector("[data-title]")
    .getAttribute("data-title");
  const theme = useTheme();
  const {
    activeTab,
    setActiveTab,
    columnMenu,
    columns,
    dismissMenu,
    getAllDataColumns,
    getOrderedColumns,
    gridRef,
    hiddenColumns,
    onColumnMoved,
    onGridReady,
    rawColumns,
    refreshResults,
    setColumnVisibility,
    setColumnsVisible,
    setOnColumnSelect,
    totalRowCount,
    totalColumnCount,
    viewProperties,
  } = useDataViewer();

  const selection = useSelection(getAllDataColumns);

  const handleKeydown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (columnMenu) {
          dismissMenu();
        } else if (selection.hasSelection()) {
          selection.clearSelection();
          gridRef.current?.api.refreshCells({ force: true });
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        if (selection.hasSelection() && gridRef.current?.api) {
          event.preventDefault();
          const csv = getSelectedDataAsCSV(
            selection.selection,
            gridRef.current.api,
            getAllDataColumns(),
          );
          navigator.clipboard.writeText(csv);
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        if (gridRef.current?.api) {
          event.preventDefault();
          event.stopPropagation();
          const allDataCols = getAllDataColumns();
          const lastRow = gridRef.current.api.getDisplayedRowCount() - 1;
          selection.selectAll(lastRow, allDataCols);
          gridRef.current.api.refreshCells({ force: true });
          gridRef.current.api.refreshHeader();
        }
      }
    },
    [columnMenu, dismissMenu, selection, gridRef, getAllDataColumns],
  );
  const dismissMenuWithoutFocus = useCallback(
    () => dismissMenu(false),
    [dismissMenu],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("blur", dismissMenuWithoutFocus);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("blur", dismissMenuWithoutFocus);
    };
  }, [handleKeydown, dismissMenuWithoutFocus]);

  const onCellClicked = useCallback(
    (event: CellClickedEvent) => {
      const rowIndex = event.rowIndex;
      const colField = event.colDef.field;
      if (rowIndex === null || rowIndex === undefined || !colField) {
        return;
      }
      const shiftKey =
        (event.event as MouseEvent | undefined)?.shiftKey ?? false;
      if (colField === "#") {
        selection.selectRow(rowIndex, shiftKey);
      } else {
        selection.selectCell(rowIndex, colField, shiftKey);
      }
      gridRef.current?.api.refreshCells({ force: true });
    },
    [selection, gridRef],
  );

  const onColumnSelect = useCallback(
    (colId: string, shiftKey: boolean) => {
      selection.selectColumn(colId, shiftKey);
      gridRef.current?.api.refreshCells({ force: true });
    },
    [selection, gridRef],
  );

  useEffect(() => {
    setOnColumnSelect(onColumnSelect);
  }, [setOnColumnSelect, onColumnSelect]);

  if (columns.length === 0) {
    return null;
  }

  return (
    <div className="data-viewer">
      <h1>{title}</h1>
      {(totalRowCount !== undefined || totalColumnCount !== undefined) && (
        <div className="row-count-bar">
          {selection.hasSelection() && (
            <span className="selection-hint">
              {localize("Press {0} to copy as CSV", { "0": copyHintKey })}
            </span>
          )}
          <span className="row-count">
            {[
              totalRowCount !== undefined ? `${totalRowCount} rows` : undefined,
              totalColumnCount !== undefined
                ? `${totalColumnCount} columns`
                : undefined,
            ]
              .filter(Boolean)
              .join(", ")}
          </span>
        </div>
      )}
      <TabBar
        tabs={["Data", "Columns"]}
        activeTab={activeTab}
        onTabChange={(tab) =>
          setActiveTab(tab.toLowerCase() as "data" | "columns")
        }
      />
      <div style={{ display: activeTab === "data" ? "contents" : "none" }}>
        <TableFilter
          onCommit={(value) => {
            refreshResults({ filterValue: value });
          }}
          initialValue={viewProperties()?.query?.filterValue ?? ""}
        />
        {columnMenu && <ColumnMenu {...columnMenu} />}
        <div
          className={`ag-grid-wrapper ${theme}`}
          style={gridStyles}
          onClick={() => columnMenu && dismissMenuWithoutFocus()}
        >
          <AgGridReact
            ref={gridRef}
            cacheBlockSize={100}
            columnDefs={columns}
            context={{
              isCellSelected: selection.isCellSelected,
              isColumnSelected: (col: string) => {
                const sel = selection.selection;
                if (!sel.anchor || !sel.end || !sel.mode) {
                  return false;
                }
                if (sel.mode !== "column" && sel.mode !== "range") {
                  return false;
                }
                const allCols = getAllDataColumns();
                const startIdx = allCols.indexOf(sel.anchor.col);
                const endIdx = allCols.indexOf(sel.end.col);
                const colIdx = allCols.indexOf(col);
                if (startIdx === -1 || endIdx === -1 || colIdx === -1) {
                  return false;
                }
                const [lo, hi] =
                  startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
                return colIdx >= lo && colIdx <= hi;
              },
            }}
            defaultColDef={{
              sortable: true,
            }}
            maintainColumnOrder
            infiniteInitialRowCount={100}
            maxBlocksInCache={10}
            onGridReady={onGridReady}
            onCellClicked={onCellClicked}
            onColumnMoved={onColumnMoved}
            rowModelType="infinite"
            theme="legacy"
            noRowsOverlayComponent={() =>
              localize("No data matches the current filters.")
            }
            suppressDragLeaveHidesColumns
          />
        </div>
      </div>
      {activeTab === "columns" && (
        <ColumnManager
          columns={getOrderedColumns()}
          hiddenColumns={hiddenColumns}
          onVisibilityChange={setColumnVisibility}
          onBulkVisibilityChange={setColumnsVisible}
        />
      )}
    </div>
  );
};

const root = createRoot(document.querySelector(".data-viewer-container"));
root.render(<DataViewer />);
