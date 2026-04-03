// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Uri, l10n, window } from "vscode";

import type { ColumnState, SortModelItem } from "ag-grid-community";

import PaginatedResultSet from "../components/LibraryNavigator/PaginatedResultSet";
import { TableData, TableQuery } from "../components/LibraryNavigator/types";
import { Column } from "../connection/rest/api/compute";
import { WebView } from "./WebviewManager";

export type ViewProperties = {
  columnState?: ColumnState[];
  query?: TableQuery;
  hiddenColumns?: string[];
};

export const DATA_VIEWER_VIEW_TYPE = "SAS.dataViewer";

class DataViewer extends WebView {
  public viewProperties: ViewProperties = {};
  public onBecameActive: (() => void) | undefined;
  public constructor(
    extensionUri: Uri,
    uid: string,
    protected readonly paginator: PaginatedResultSet<{
      data: TableData;
      error?: Error;
    }>,
    protected readonly fetchColumns: () => Column[],
    protected readonly loadColumnProperties: (columnName: string) => void,
    protected readonly fetchRowCount?: () => Promise<{
      rowCount: number;
      columnCount?: number;
    }>,
  ) {
    super(extensionUri, uid);
  }

  public getViewType(): string {
    return DATA_VIEWER_VIEW_TYPE;
  }

  public l10nMessages() {
    return {
      "Ascending (add to sorting)": l10n.t("Ascending (add to sorting)"),
      "Descending (add to sorting)": l10n.t("Descending (add to sorting)"),
      "Enter expression": l10n.t("Enter expression"),
      "No data matches the current filters.": l10n.t(
        "No data matches the current filters.",
      ),
      "Not pinned": l10n.t("Not pinned"),
      "Pinned to the left": l10n.t("Pinned to the left"),
      "Pinned to the right": l10n.t("Pinned to the right"),
      "Remove all sorting": l10n.t("Remove all sorting"),
      "Remove sorting": l10n.t("Remove sorting"),
      "Row number": l10n.t("Row number"),
      "Sorted, Ascending": l10n.t("Sorted, Ascending"),
      "Sorted, Descending": l10n.t("Sorted, Descending"),
      Ascending: l10n.t("Ascending"),
      Character: l10n.t("Character"),
      Clear: l10n.t("Clear"),
      Columns: l10n.t("Columns"),
      Copy: l10n.t("Copy"),
      "Copy all": l10n.t("Copy all"),
      "Copy as CSV": l10n.t("Copy as CSV"),
      "Copy column names": l10n.t("Copy column names"),
      Currency: l10n.t("Currency"),
      Data: l10n.t("Data"),
      Date: l10n.t("Date"),
      Datetime: l10n.t("Datetime"),
      Descending: l10n.t("Descending"),
      Format: l10n.t("Format"),
      Informat: l10n.t("Informat"),
      Invert: l10n.t("Invert"),
      "Invert selection": l10n.t("Invert selection"),
      Label: l10n.t("Label"),
      Length: l10n.t("Length"),
      Name: l10n.t("Name"),
      Numeric: l10n.t("Numeric"),
      Options: l10n.t("Options"),
      Pin: l10n.t("Pin"),
      "Press {0} to copy as CSV": l10n.t("Press {0} to copy as CSV"),
      Properties: l10n.t("Properties"),
      "Search columns": l10n.t("Search columns"),
      "Select all": l10n.t("Select all"),
      "Select all columns": l10n.t("Select all columns"),
      "Deselect all columns": l10n.t("Deselect all columns"),
      "Copy selected column names": l10n.t("Copy selected column names"),
      "Copy all column names": l10n.t("Copy all column names"),
      "Drag to reorder": l10n.t("Drag to reorder"),
      "Sort A-Z": l10n.t("Sort A-Z"),
      "Sort Z-A": l10n.t("Sort Z-A"),
      "Sort columns A-Z": l10n.t("Sort columns A-Z"),
      "Sort columns Z-A": l10n.t("Sort columns Z-A"),
      "Move selected to top": l10n.t("Move selected to top"),
      "Move selected columns to top": l10n.t("Move selected columns to top"),
      "Copy selected": l10n.t("Copy selected"),
      "Auto-size": l10n.t("Auto-size"),
      "Fixed width": l10n.t("Fixed width"),
      "Auto-size all columns": l10n.t("Auto-size all columns"),
      "Set all columns to fixed width": l10n.t(
        "Set all columns to fixed width",
      ),
      Sort: l10n.t("Sort"),
      Type: l10n.t("Type"),
    };
  }

  public styles() {
    return ["DataViewer.css"];
  }

  public scripts() {
    return ["DataViewer.js"];
  }

  public body() {
    return `<div class="data-viewer-container" data-title="${this.title}"></div>`;
  }

  protected onPanelAttached(): void {
    // Fire immediately — a newly attached panel is always the active one.
    this.onBecameActive?.();
    this._disposables.push(
      this.getPanel().onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) {
          this.onBecameActive?.();
        }
      }),
    );
  }

  public async processMessage(
    event: Event & {
      key: string;
      command: string;
      data?: {
        start?: number;
        end?: number;
        sortModel?: SortModelItem[];
        columnName?: string;
        viewProperties?: Partial<ViewProperties>;
        query: TableQuery | undefined;
      };
    },
  ): Promise<void> {
    switch (event.command) {
      case "request:loadData": {
        const { data, error } = await this.paginator.getData(
          event.data!.start!,
          event.data!.end!,
          event.data!.sortModel!,
          event.data!.query!,
        );
        this.panel.webview.postMessage({
          command: "response:loadData",
          key: event.key,
          data,
        });
        if (error) {
          await window.showErrorMessage(error.message);
        }
        break;
      }
      case "request:loadColumns":
        this.panel.webview.postMessage({
          key: event.key,
          command: "response:loadColumns",
          data: {
            columns: await this.fetchColumns(),
            viewProperties: this.viewProperties,
            ...(await this.fetchRowCount?.()),
          },
        });
        break;
      case "request:loadColumnProperties":
        if (event.data.columnName) {
          this.loadColumnProperties(event.data.columnName);
        }
        break;
      case "request:storeViewProperties":
        if (event.data.viewProperties) {
          this.viewProperties = {
            ...this.viewProperties,
            ...event.data.viewProperties,
          };
        }
        break;
      default:
        break;
    }
  }
}

export default DataViewer;
