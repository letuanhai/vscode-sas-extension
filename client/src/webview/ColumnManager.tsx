// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";

import { Column } from "../connection/rest/api/compute";
import { getIconForColumnType } from "./columnTypeIcon";
import localize from "./localize";

interface ColumnManagerProps {
  columns: Column[];
  hiddenColumns: Set<string>;
  onVisibilityChange: (columnName: string, visible: boolean) => void;
  onBulkVisibilityChange: (columnNames: string[], visible: boolean) => void;
}

const ColumnManager = ({
  columns,
  hiddenColumns,
  onVisibilityChange,
  onBulkVisibilityChange,
}: ColumnManagerProps) => {
  const [searchValue, setSearchValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const filteredColumns = columns.filter((col) => {
    if (!searchValue) {
      return true;
    }
    const search = searchValue.toLowerCase();
    const name = (col.name || "").toLowerCase();
    const label = (col.label || "").toLowerCase();
    return name.includes(search) || label.includes(search);
  });

  const handleSelectAll = () => {
    const names = filteredColumns.map((c) => c.name!);
    onBulkVisibilityChange(names, true);
  };

  const handleDeselectAll = () => {
    const names = filteredColumns.map((c) => c.name!);
    onBulkVisibilityChange(names, false);
  };

  const handleInvertSelection = () => {
    const toShow: string[] = [];
    const toHide: string[] = [];
    columns.forEach((col) => {
      const name = col.name!;
      if (hiddenColumns.has(name)) {
        toShow.push(name);
      } else {
        toHide.push(name);
      }
    });
    if (toShow.length > 0) {
      onBulkVisibilityChange(toShow, true);
    }
    if (toHide.length > 0) {
      onBulkVisibilityChange(toHide, false);
    }
  };

  const handleCopySelected = async () => {
    const selected = columns
      .filter((c) => !hiddenColumns.has(c.name!))
      .map((c) => c.name!)
      .join("\n");
    await navigator.clipboard.writeText(selected);
  };

  const handleCopyAll = async () => {
    const all = columns.map((c) => c.name!).join("\n");
    await navigator.clipboard.writeText(all);
  };

  const handleCheckboxChange = (columnName: string, checked: boolean) => {
    onVisibilityChange(columnName, checked);
  };

  return (
    <div className="column-manager">
      <div className="column-manager-search">
        <input
          ref={searchInputRef}
          type="text"
          placeholder={localize("Search columns")}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
        />
      </div>
      <div className="column-manager-toolbar">
        <button
          type="button"
          onClick={handleSelectAll}
          title={localize("Select all columns")}
        >
          {localize("Select all")}
        </button>
        <button
          type="button"
          onClick={handleDeselectAll}
          title={localize("Deselect all columns")}
        >
          {localize("Deselect all columns")}
        </button>
        <button
          type="button"
          onClick={handleInvertSelection}
          title={localize("Invert selection")}
        >
          {localize("Invert selection")}
        </button>
        <button
          type="button"
          onClick={handleCopySelected}
          title={localize("Copy selected column names")}
        >
          {localize("Copy selected column names")}
        </button>
        <button
          type="button"
          onClick={handleCopyAll}
          title={localize("Copy all column names")}
        >
          {localize("Copy all")}
        </button>
      </div>
      <div className="column-manager-list">
        <div className="column-manager-header">
          <div className="col-checkbox"></div>
          <div className="col-name">{localize("Name")}</div>
          <div className="col-type">{localize("Type")}</div>
          <div className="col-length">{localize("Length")}</div>
          <div className="col-format">{localize("Format")}</div>
          <div className="col-informat">{localize("Informat")}</div>
          <div className="col-label">{localize("Label")}</div>
        </div>
        {filteredColumns.map((col) => {
          const isVisible = !hiddenColumns.has(col.name!);
          return (
            <div key={col.name} className="column-manager-row">
              <div className="col-checkbox">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) =>
                    handleCheckboxChange(col.name!, e.target.checked)
                  }
                />
              </div>
              <div className="col-name">{col.name}</div>
              <div className="col-type">
                <span
                  className={`header-icon ${getIconForColumnType(col.type || "")}`}
                />
                <span className="type-text">{col.type || ""}</span>
              </div>
              <div className="col-length">{col.length}</div>
              <div className="col-format">{col.format?.name || ""}</div>
              <div className="col-informat">{col.informat?.name || ""}</div>
              <div className="col-label">{col.label || ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ColumnManager;
