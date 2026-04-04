// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  SQLiteExportOptions,
  escapeValue,
  generateSQLiteSQL,
  mapSASTypeToSQLite,
} from "../../src/components/LibraryNavigator/sqliteExport";
import { Column } from "../../src/connection/rest/api/compute";

const makeColumn = (name: string, type: string): Column => ({
  name,
  type,
  length: 8,
  index: 0,
});

describe("sqliteExport", () => {
  describe("mapSASTypeToSQLite", () => {
    it("maps 'char' to TEXT", () => {
      expect(mapSASTypeToSQLite("char")).to.equal("TEXT");
    });

    it("maps 'num' to REAL", () => {
      expect(mapSASTypeToSQLite("num")).to.equal("REAL");
    });

    it("maps 'float' to REAL", () => {
      expect(mapSASTypeToSQLite("float")).to.equal("REAL");
    });

    it("maps 'Numeric' (StudioWeb API) to REAL", () => {
      expect(mapSASTypeToSQLite("Numeric")).to.equal("REAL");
    });

    it("maps 'numeric' (lowercase) to REAL", () => {
      expect(mapSASTypeToSQLite("numeric")).to.equal("REAL");
    });

    it("maps 'Char' (StudioWeb API) to TEXT", () => {
      expect(mapSASTypeToSQLite("Char")).to.equal("TEXT");
    });

    it("maps 'date' to TEXT (no conversion)", () => {
      expect(mapSASTypeToSQLite("date")).to.equal("TEXT");
    });

    it("maps unknown type to TEXT", () => {
      expect(mapSASTypeToSQLite("currency")).to.equal("TEXT");
    });

    it("handles empty/undefined type as TEXT", () => {
      expect(mapSASTypeToSQLite("")).to.equal("TEXT");
    });
  });

  describe("escapeValue", () => {
    it("returns NULL for null", () => {
      expect(escapeValue(null, "char")).to.equal("NULL");
    });

    it("returns NULL for undefined", () => {
      expect(escapeValue(undefined, "char")).to.equal("NULL");
    });

    it("returns NULL for empty string", () => {
      expect(escapeValue("", "char")).to.equal("NULL");
    });

    it("returns NULL for '.' in numeric type", () => {
      expect(escapeValue(".", "num")).to.equal("NULL");
    });

    it("returns numeric value unquoted for num type", () => {
      expect(escapeValue("42", "num")).to.equal("42");
      expect(escapeValue("3.14", "num")).to.equal("3.14");
      expect(escapeValue("-7", "float")).to.equal("-7");
    });

    it("returns NULL for non-numeric string in num type", () => {
      expect(escapeValue("abc", "num")).to.equal("NULL");
    });

    it("single-quotes char values", () => {
      expect(escapeValue("hello", "char")).to.equal("'hello'");
    });

    it("escapes single quotes in char values", () => {
      expect(escapeValue("it's", "char")).to.equal("'it''s'");
    });

    it("escapes multiple single quotes", () => {
      expect(escapeValue("O'Brien's", "char")).to.equal("'O''Brien''s'");
    });

    it("handles numeric zero correctly", () => {
      expect(escapeValue("0", "num")).to.equal("0");
    });

    it("trims whitespace before parsing num type", () => {
      expect(escapeValue("  42.5  ", "num")).to.equal("42.5");
      expect(escapeValue("  .  ", "num")).to.equal("NULL");
    });

    it("handles Numeric type (StudioWeb API): plain number", () => {
      expect(escapeValue("         3.5", "Numeric")).to.equal("3.5");
      expect(escapeValue("  23  ", "Numeric")).to.equal("23");
      expect(escapeValue(".", "Numeric")).to.equal("NULL");
      expect(escapeValue("  ", "Numeric")).to.equal("NULL");
    });

    it("handles Numeric type (StudioWeb API): formatted value stored as text", () => {
      expect(escapeValue(" $36,945", "Numeric")).to.equal("'$36,945'");
      expect(escapeValue("01JAN2020", "Numeric")).to.equal("'01JAN2020'");
    });

    it("trims trailing spaces from char values (SAS fixed-length padding)", () => {
      expect(escapeValue("Acura        ", "char")).to.equal("'Acura'");
      expect(escapeValue("SUV     ", "Char")).to.equal("'SUV'");
    });

    it("trims trailing spaces from Char type (StudioWeb API)", () => {
      expect(escapeValue("hello   ", "Char")).to.equal("'hello'");
    });

    it("returns NULL for whitespace-only char value", () => {
      expect(escapeValue("     ", "char")).to.equal("NULL");
    });
  });

  describe("generateSQLiteSQL", () => {
    const columns: Column[] = [
      makeColumn("Make", "char"),
      makeColumn("MSRP", "num"),
    ];

    const rows: string[][] = [
      ["Acura", "36945"],
      ["Honda", ""],
    ];

    const opts: SQLiteExportOptions = {
      tableName: "WORK.CARS",
      columns,
      rows,
      includeDropTable: true,
    };

    it("includes a comment header", () => {
      const sql = generateSQLiteSQL(opts);
      expect(sql).to.include("-- SAS Dataset: WORK.CARS");
      expect(sql).to.include("-- Exported from SAS Extension");
    });

    it("includes DROP TABLE IF EXISTS when requested", () => {
      const sql = generateSQLiteSQL(opts);
      expect(sql).to.include('DROP TABLE IF EXISTS "WORK.CARS"');
    });

    it("omits DROP TABLE when not requested", () => {
      const sql = generateSQLiteSQL({ ...opts, includeDropTable: false });
      expect(sql).to.not.include("DROP TABLE");
    });

    it("creates table with correct column types", () => {
      const sql = generateSQLiteSQL(opts);
      expect(sql).to.include('"Make" TEXT');
      expect(sql).to.include('"MSRP" REAL');
    });

    it("wraps inserts in transaction", () => {
      const sql = generateSQLiteSQL(opts);
      expect(sql).to.include("BEGIN TRANSACTION");
      expect(sql).to.include("COMMIT");
    });

    it("inserts rows with correct values", () => {
      const sql = generateSQLiteSQL(opts);
      expect(sql).to.include("INSERT INTO \"WORK.CARS\" VALUES");
      expect(sql).to.include("('Acura', 36945)");
      expect(sql).to.include("('Honda', NULL)");
    });

    it("handles empty rows array", () => {
      const sql = generateSQLiteSQL({ ...opts, rows: [] });
      expect(sql).to.include("CREATE TABLE");
      expect(sql).to.not.include("INSERT INTO");
      expect(sql).to.not.include("BEGIN TRANSACTION");
    });

    it("double-quotes identifiers with embedded double quotes", () => {
      const quotedOpts: SQLiteExportOptions = {
        tableName: 'MY"TABLE',
        columns: [makeColumn('COL"A', "char")],
        rows: [["val"]],
        includeDropTable: false,
      };
      const sql = generateSQLiteSQL(quotedOpts);
      expect(sql).to.include('"MY""TABLE"');
      expect(sql).to.include('"COL""A"');
    });

    it("handles StudioWeb API capitalized types (Numeric/Char) with padded values", () => {
      const studioWebOpts: SQLiteExportOptions = {
        tableName: "SASHELP.CARS",
        columns: [makeColumn("Make", "Char"), makeColumn("MSRP", "Numeric")],
        rows: [
          ["Acura        ", " $36,945"],
          ["Honda        ", " $23,820"],
        ],
        includeDropTable: false,
      };
      const sql = generateSQLiteSQL(studioWebOpts);
      expect(sql).to.include('"Make" TEXT');
      expect(sql).to.include('"MSRP" REAL');
      expect(sql).to.include("('Acura', '$36,945')");
      expect(sql).to.include("('Honda', '$23,820')");
    });

    it("handles plain Numeric values as numbers", () => {
      const numericOpts: SQLiteExportOptions = {
        tableName: "T",
        columns: [makeColumn("EngineSize", "Numeric")],
        rows: [["         3.5"], ["         2.0"]],
        includeDropTable: false,
      };
      const sql = generateSQLiteSQL(numericOpts);
      expect(sql).to.include('"EngineSize" REAL');
      expect(sql).to.include("(3.5)");
      expect(sql).to.include("(2)");
    });

    it("splits into batches of 500", () => {
      const manyRows: string[][] = Array.from({ length: 600 }, (_, i) => [
        `val${i}`,
      ]);
      const batchOpts: SQLiteExportOptions = {
        tableName: "T",
        columns: [makeColumn("A", "char")],
        rows: manyRows,
        includeDropTable: false,
      };
      const sql = generateSQLiteSQL(batchOpts);
      // Should have exactly 2 INSERT INTO statements (500 + 100)
      const insertCount = (sql.match(/INSERT INTO/g) || []).length;
      expect(insertCount).to.equal(2);
    });
  });
});
