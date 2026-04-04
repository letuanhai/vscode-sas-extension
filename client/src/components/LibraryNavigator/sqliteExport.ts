// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Column } from "../../connection/rest/api/compute";

export interface SQLiteExportOptions {
  tableName: string;
  columns: Column[];
  rows: string[][];
  includeDropTable: boolean;
}

/**
 * Map a SAS column type to a SQLite storage type.
 * Handles both canonical SAS types ("num", "char") and the capitalized forms
 * returned by the SAS Studio Web API ("Numeric", "Char").
 */
export function mapSASTypeToSQLite(type: string): string {
  if (!type) {
    return "TEXT";
  }
  const lower = type.toLowerCase();
  if (lower === "num" || lower === "float" || lower === "numeric") {
    return "REAL";
  }
  return "TEXT";
}

/**
 * Escape a single cell value for use in a SQLite INSERT statement.
 *
 * Rules:
 * - Empty / null / undefined                → NULL
 * - Numeric type ("num"/"float") with "."   → NULL (SAS missing numeric)
 * - Numeric type, valid number              → unquoted number string
 * - "Numeric" (StudioWeb API type), valid number → unquoted number string
 * - "Numeric", non-numeric string (formatted, e.g. "$36,945") → quoted text
 * - Text type                               → single-quoted, trailing spaces trimmed
 */
export function escapeValue(
  value: string | null | undefined,
  columnType: string,
): string {
  if (value === "" || value === null || value === undefined) {
    return "NULL";
  }
  const lower = (columnType || "").toLowerCase();
  if (lower === "num" || lower === "float") {
    // Trim formatting whitespace before parsing (e.g. "  42.5" from BEST. format)
    const trimmed = value.trim();
    if (trimmed === ".") {
      return "NULL";
    }
    const n = Number(trimmed);
    return isNaN(n) ? "NULL" : String(n);
  }
  if (lower === "numeric") {
    // SAS Studio Web API returns "Numeric" for all numeric columns.
    // Values may be plain numbers ("  3.5") or formatted strings (" $36,945").
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === ".") {
      return "NULL";
    }
    const n = Number(trimmed);
    if (!isNaN(n)) {
      return String(n);
    }
    // Formatted numeric value (currency, date, etc.): store as text
    return `'${trimmed.replace(/'/g, "''")}'`;
  }
  // Text: trim trailing spaces (SAS pads fixed-length char columns) and quote
  const trimmed = value.trimEnd();
  if (trimmed === "") {
    return "NULL";
  }
  return `'${trimmed.replace(/'/g, "''")}'`;
}

/**
 * Quote a SQL identifier (table name or column name) using double-quotes,
 * escaping any embedded double-quotes as "".
 */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const BATCH_SIZE = 500;

/**
 * Generate a complete SQLite SQL script that creates a table and inserts the
 * supplied rows.
 */
export function generateSQLiteSQL(options: SQLiteExportOptions): string {
  const { tableName, columns, rows, includeDropTable } = options;

  const lines: string[] = [];

  // Comment header
  lines.push(
    `-- SAS Dataset: ${tableName} (${columns.length} columns, ${rows.length} rows)`,
  );
  lines.push("-- Exported from SAS Extension");
  lines.push("");

  // DROP TABLE IF EXISTS
  if (includeDropTable) {
    lines.push(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)};`);
    lines.push("");
  }

  // CREATE TABLE
  const colDefs = columns
    .map((col) => `  ${quoteIdentifier(col.name!)} ${mapSASTypeToSQLite(col.type!)}`)
    .join(",\n");
  lines.push(`CREATE TABLE ${quoteIdentifier(tableName)} (`);
  lines.push(colDefs);
  lines.push(");");
  lines.push("");

  if (rows.length === 0) {
    return lines.join("\n");
  }

  lines.push("BEGIN TRANSACTION;");
  lines.push("");

  // INSERT batches
  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);
    lines.push(`INSERT INTO ${quoteIdentifier(tableName)} VALUES`);
    const valueLines = batch.map((row, idx) => {
      const values = columns.map((col, colIdx) =>
        escapeValue(row[colIdx], col.type!),
      );
      const comma = idx < batch.length - 1 ? "," : "";
      return `  (${values.join(", ")})${comma}`;
    });
    lines.push(...valueLines);
    lines.push(";");
    lines.push("");
  }

  lines.push("COMMIT;");

  return lines.join("\n");
}
