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
  onColumnOrderChange?: (columnNames: string[]) => void;
}

const ColumnManager = ({
  columns,
  hiddenColumns,
  onVisibilityChange,
  onBulkVisibilityChange,
  onColumnOrderChange,
}: ColumnManagerProps) => {
  const [searchValue, setSearchValue] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
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

  const handleSortAZ = () => {
    const sorted = [...columns].sort((a, b) =>
      (a.name || "").localeCompare(b.name || ""),
    );
    onColumnOrderChange?.(sorted.map((c) => c.name!));
  };

  const handleSortZA = () => {
    const sorted = [...columns].sort((a, b) =>
      (b.name || "").localeCompare(a.name || ""),
    );
    onColumnOrderChange?.(sorted.map((c) => c.name!));
  };

  const handleMoveSelectedToTop = () => {
    const visible: Column[] = [];
    const hidden: Column[] = [];
    columns.forEach((col) => {
      if (hiddenColumns.has(col.name!)) {
        hidden.push(col);
      } else {
        visible.push(col);
      }
    });
    const reordered = [...visible, ...hidden];
    onColumnOrderChange?.(reordered.map((c) => c.name!));
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

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      setDropIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDropIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIdx || searchValue) {
      setDragIndex(null);
      setDropIndex(null);
      return;
    }
    const newOrder = [...columns];
    const [dragged] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIdx, 0, dragged);
    onColumnOrderChange?.(newOrder.map((c) => c.name!));
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
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
        <div className="toolbar-group">
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
            {localize("Deselect all")}
          </button>
          <button
            type="button"
            onClick={handleInvertSelection}
            title={localize("Invert selection")}
          >
            {localize("Invert")}
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button
            type="button"
            onClick={handleSortAZ}
            title={localize("Sort columns A-Z")}
          >
            {localize("Sort A-Z")}
          </button>
          <button
            type="button"
            onClick={handleSortZA}
            title={localize("Sort columns Z-A")}
          >
            {localize("Sort Z-A")}
          </button>
          <button
            type="button"
            onClick={handleMoveSelectedToTop}
            title={localize("Move selected columns to top")}
          >
            {localize("Move selected to top")}
          </button>
        </div>
        <div className="toolbar-divider" />
        <div className="toolbar-group">
          <button
            type="button"
            onClick={handleCopySelected}
            title={localize("Copy selected column names")}
          >
            {localize("Copy selected")}
          </button>
          <button
            type="button"
            onClick={handleCopyAll}
            title={localize("Copy all column names")}
          >
            {localize("Copy all")}
          </button>
        </div>
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
        {filteredColumns.map((col, index) => {
          const isVisible = !hiddenColumns.has(col.name!);
          const isDragTarget =
            dropIndex === index && dragIndex !== null && dragIndex !== index;
          const isDragging = dragIndex === index;
          return (
            <div
              key={col.name}
              className={`column-manager-row${isDragging ? " dragging" : ""}${isDragTarget ? " drop-target" : ""}`}
              draggable={!searchValue}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
              <div className="col-checkbox">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) =>
                    handleCheckboxChange(col.name!, e.target.checked)
                  }
                />
              </div>
              <div className="col-name">
                {!searchValue && (
                  <span
                    className="drag-handle"
                    title={localize("Drag to reorder")}
                  >
                    ⠿
                  </span>
                )}
                {col.name}
              </div>
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
