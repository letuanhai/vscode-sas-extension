// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import type { SortModelItem } from "ag-grid-community";

import { ColumnCollection, TableInfo } from "../../connection/rest/api/compute";

export const LibraryType = "library";
export const TableType = "table";
export const ViewType = "view";
export type LibraryItemType = "library" | "table" | "view";
export interface LibraryItem {
  uid: string;
  id: string;
  name: string;
  type: LibraryItemType;
  library?: string;
  readOnly: boolean;
}

export interface TableRow {
  cells?: string[];
  columns?: string[];
}

export interface TableData {
  rows: TableRow[];
  count: number;
}

export interface TableQuery {
  filterValue: string;
}

export interface LibraryPath {
  physicalName: string;
  engineName: string;
  infoProperties?: Record<string, string>;
}

export interface LibraryInfo {
  name: string;
  engine: string;
  readOnly: boolean;
  paths: LibraryPath[];
}

export interface LibraryAdapter {
  connect(): Promise<void>;
  deleteTable(item: LibraryItem): Promise<void>;
  getColumns(
    item: LibraryItem,
    start: number,
    limit: number,
  ): Promise<ColumnCollection>;
  getLibraries(
    start: number,
    limit: number,
  ): Promise<{
    items: LibraryItem[];
    count: number;
  }>;
  getRows(
    item: LibraryItem,
    start: number,
    limit: number,
    sortModel: SortModelItem[],
    query: TableQuery | undefined,
  ): Promise<TableData>;
  getRowsAsCSV(
    item: LibraryItem,
    start: number,
    limit: number,
  ): Promise<TableData>;
  getTableRowCount(item: LibraryItem): Promise<{
    rowCount: number;
    maxNumberOfRowsToRead: number;
    columnCount?: number;
  }>;
  getTables(
    item: LibraryItem,
    start: number,
    limit: number,
  ): Promise<{
    items: LibraryItem[];
    count: number;
  }>;
  getTableInfo?(item: LibraryItem): Promise<TableInfo>;
  getLibraryInfo?(item: LibraryItem): Promise<LibraryInfo>;
  setup(): Promise<void>;
}
