// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import { LogCounter } from "../../src/components/logViewer/logCounter";
import { LogLine } from "../../src/connection";

describe("LogCounter", () => {
  let counter: LogCounter;

  beforeEach(() => {
    counter = new LogCounter();
  });

  it("counts typed error lines", () => {
    counter.count({ type: "error", line: "ERROR: Something failed" });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 1,
      warningCount: 0,
    });
  });

  it("counts typed warning lines", () => {
    counter.count({ type: "warning", line: "WARNING: Check this" });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 0,
      warningCount: 1,
    });
  });

  it("ignores note and normal typed lines that do not match a pattern", () => {
    counter.count({ type: "note", line: "NOTE: Processing complete." });
    counter.count({ type: "normal", line: "Some random log text" });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 0,
      warningCount: 0,
    });
  });

  it("falls back to text pattern for normal-type lines (SSH/StudioWeb)", () => {
    counter.count({ type: "normal", line: "ERROR: File not found." });
    counter.count({ type: "normal", line: "WARNING: Variable X not initialized." });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 1,
      warningCount: 1,
    });
  });

  it("matches numbered SAS errors and warnings", () => {
    counter.count({ type: "normal", line: "ERROR 22-322: Syntax error." });
    counter.count({ type: "normal", line: "WARNING 1-322: Apparent symbolic reference not resolved." });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 1,
      warningCount: 1,
    });
  });

  it("is case-insensitive for text matching", () => {
    counter.count({ type: "normal", line: "error: lowercase issue" });
    counter.count({ type: "normal", line: "WARNING: uppercase issue" });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 1,
      warningCount: 1,
    });
  });

  it("does not double-count when type and text both indicate error", () => {
    counter.count({ type: "error", line: "ERROR 79-322: Expecting a )." });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 1,
      warningCount: 0,
    });
  });

  it("accumulates across multiple lines", () => {
    const lines: LogLine[] = [
      { type: "error", line: "ERROR: First error" },
      { type: "warning", line: "WARNING: First warning" },
      { type: "normal", line: "ERROR: Second error via text" },
      { type: "note", line: "NOTE: Just a note" },
      { type: "warning", line: "WARNING: Second warning" },
    ];
    lines.forEach((line) => counter.count(line));
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 2,
      warningCount: 2,
    });
  });

  it("resets counts to zero", () => {
    counter.count({ type: "error", line: "ERROR: Oops" });
    counter.count({ type: "warning", line: "WARNING: Careful" });
    counter.reset();
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 0,
      warningCount: 0,
    });
  });

  it("ignores lines that only contain whitespace", () => {
    counter.count({ type: "normal", line: "   " });
    counter.count({ type: "normal", line: "" });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 0,
      warningCount: 0,
    });
  });

  it("ignores lines that look like errors but lack the colon separator", () => {
    counter.count({ type: "normal", line: "ERROR file not found" });
    counter.count({ type: "normal", line: "WARNING missing variable" });
    expect(counter.getCounts()).to.deep.equal({
      errorCount: 0,
      warningCount: 0,
    });
  });
});
