// Copyright © 2022-2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { TextDocument } from "vscode-languageserver-textdocument";

import { assert } from "chai";

import { LanguageServiceProvider } from "../../src/sas/LanguageServiceProvider";
import { LexerEx } from "../../src/sas/LexerEx";

const createDoc = (content: string): TextDocument => {
  return TextDocument.create("test://test.sas", "sas", 1, content);
};

describe("DO block folding", () => {
  it("folds a simple do/end block inside a data step", () => {
    const doc = createDoc(`data _null_;
    do i = 1 to 10;
        x = i;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    // Should have DATA block (0-4) and DO block (1-3)
    const doRange = ranges.find((r) => r.startLine === 1);
    assert.exists(doRange, "DO block folding range should exist");
    assert.strictEqual(doRange!.endLine, 3, "DO block should end at line 3");
  });

  it("folds nested do/end blocks", () => {
    const doc = createDoc(`data _null_;
    do i = 1 to 10;
        do j = 1 to 10;
            x = i * j;
        end;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const outerDo = ranges.find((r) => r.startLine === 1);
    const innerDo = ranges.find((r) => r.startLine === 2);

    assert.exists(outerDo, "Outer DO block should exist");
    assert.exists(innerDo, "Inner DO block should exist");
    assert.strictEqual(outerDo!.endLine, 5, "Outer DO should end at line 5");
    assert.strictEqual(innerDo!.endLine, 4, "Inner DO should end at line 4");
  });

  it("folds do while blocks", () => {
    const doc = createDoc(`data _null_;
    do while (x < 10);
        x + 1;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const doRange = ranges.find((r) => r.startLine === 1);
    assert.exists(doRange, "DO WHILE block should exist");
    assert.strictEqual(doRange!.endLine, 3);
  });

  it("folds do until blocks", () => {
    const doc = createDoc(`data _null_;
    do until (x > 10);
        x + 1;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const doRange = ranges.find((r) => r.startLine === 1);
    assert.exists(doRange, "DO UNTIL block should exist");
    assert.strictEqual(doRange!.endLine, 3);
  });

  it("does not create a do block for end= dataset option", () => {
    const doc = createDoc(`data _null_;
    set foo end=last;
    if last then put "done";
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const doRange = ranges.find((r) => r.startLine === 1);
    assert.notExists(doRange, "Should not create a DO block for end= option");
  });

  it("closes open do blocks when data step ends with run", () => {
    const doc = createDoc(`data _null_;
    do i = 1 to 10;
        x = i;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const doRange = ranges.find((r) => r.startLine === 1);
    assert.exists(doRange, "DO block should be closed by RUN");
    assert.strictEqual(doRange!.endLine, 3);
  });

  it("closes open do blocks when a new proc starts", () => {
    const doc = createDoc(`data _null_;
    do i = 1 to 10;
        x = i;
proc print;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const doRange = ranges.find((r) => r.startLine === 1);
    assert.exists(doRange, "DO block should be closed by PROC");
    // The DO block ends at the line before PROC starts
    assert.strictEqual(doRange!.endLine, 2);
  });

  it("includes do blocks in document symbols", () => {
    const doc = createDoc(`data _null_;
    do i = 1 to 10;
        x = i;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const symbols = lsp.getDocumentSymbols();

    assert.strictEqual(symbols.length, 1, "Should have one root symbol");
    assert.ok(symbols[0].name.startsWith("DATA"), "Root symbol should be DATA");
    assert.strictEqual(symbols[0].children!.length, 1, "DATA should have one child");
    assert.ok(symbols[0].children![0].name.startsWith("DO"), "Child symbol should be DO block");
  });

  it("folds if ... then do; end;", () => {
    const doc = createDoc(`data _null_;
    if x > 0 then do;
        y = 1;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const doRange = ranges.find((r) => r.startLine === 1);
    assert.exists(doRange, "DO block after THEN should fold");
    assert.strictEqual(doRange!.endLine, 3);
  });

  it("folds select when do; end;", () => {
    const doc = createDoc(`data _null_;
    select;
        when (1) do;
            x = 1;
        end;
        otherwise do;
            x = 2;
        end;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const whenDo = ranges.find((r) => r.startLine === 2);
    const otherwiseDo = ranges.find((r) => r.startLine === 5);
    assert.exists(whenDo, "WHEN DO block should fold");
    assert.exists(otherwiseDo, "OTHERWISE DO block should fold");
    assert.strictEqual(whenDo!.endLine, 4);
    assert.strictEqual(otherwiseDo!.endLine, 7);
  });

  it("folds select block with end;", () => {
    const doc = createDoc(`data _null_;
    select (grade);
        when ('A') gpa = 4.0;
        when ('B') gpa = 3.0;
        otherwise gpa = 0;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const selectRange = ranges.find((r) => r.startLine === 1);
    assert.exists(selectRange, "SELECT block should fold");
    assert.strictEqual(selectRange!.endLine, 5);
  });

  it("folds select without expression", () => {
    const doc = createDoc(`data _null_;
    select;
        when (x > 0) y = 1;
        otherwise y = 0;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const selectRange = ranges.find((r) => r.startLine === 1);
    assert.exists(selectRange, "SELECT block should fold");
    assert.strictEqual(selectRange!.endLine, 4);
  });

  it("folds nested select inside do", () => {
    const doc = createDoc(`data _null_;
    do i = 1 to 10;
        select (i);
            when (1) x = 1;
            otherwise x = 0;
        end;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const doRange = ranges.find((r) => r.startLine === 1);
    const selectRange = ranges.find((r) => r.startLine === 2);
    assert.exists(doRange, "DO block should fold");
    assert.exists(selectRange, "SELECT block should fold");
    assert.strictEqual(doRange!.endLine, 6);
    assert.strictEqual(selectRange!.endLine, 5);
  });

  it("folds select with do inside when", () => {
    const doc = createDoc(`data _null_;
    select;
        when (1) do;
            x = 1;
        end;
    end;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const selectRange = ranges.find((r) => r.startLine === 1);
    const doRange = ranges.find((r) => r.startLine === 2);
    assert.exists(selectRange, "SELECT block should fold");
    assert.exists(doRange, "DO block inside WHEN should fold");
    assert.strictEqual(selectRange!.endLine, 5);
    assert.strictEqual(doRange!.endLine, 4);
  });

  it("closes open select blocks when data step ends with run", () => {
    const doc = createDoc(`data _null_;
    select;
        when (1) x = 1;
run;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const selectRange = ranges.find((r) => r.startLine === 1);
    assert.exists(selectRange, "SELECT block should be closed by RUN");
    assert.strictEqual(selectRange!.endLine, 3);
  });

  it("does not fold select inside proc steps", () => {
    const doc = createDoc(`proc sql;
    select * from t;
quit;`);
    const lsp = new LanguageServiceProvider(doc);
    const ranges = lsp.getFoldingRanges();

    const selectRange = ranges.find((r) => r.startLine === 1);
    assert.notExists(selectRange, "Should not fold inside PROC");
  });
});
