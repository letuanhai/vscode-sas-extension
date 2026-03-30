// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tests for the pure helper functions in OutputDatasetPanel.ts.
// Because that module imports vscode (for showOutputDatasets), we duplicate
// the pure functions here and keep them in sync with the source.
import { assert } from "chai";

// ---------------------------------------------------------------------------
// Duplicated from client/src/components/run/OutputDatasetPanel.ts
// Keep in sync with the source implementation.
// ---------------------------------------------------------------------------

const buildOutputDatasetsHtml = (
  dataSets: Array<{ library: string; member: string }>,
): string => {
  const buttons = dataSets
    .map(({ library, member }) => {
      const escapedLibrary = library.replace(/'/g, "\\'");
      const escapedMember = member.replace(/'/g, "\\'");
      return `<button
  style="margin: 0 8px 4px 0; padding: 4px 12px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px;"
  onmouseover="this.style.background='var(--vscode-button-hoverBackground)'"
  onmouseout="this.style.background='var(--vscode-button-background)'"
  onclick="window._vsApi?.postMessage({type:'viewDataset',library:'${escapedLibrary}',member:'${escapedMember}'})"
>View ${library}.${member}</button>`;
    })
    .join("\n");

  return `<div style="padding: 12px 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground);">
  <h4 style="margin: 0 0 8px;">Output Datasets</h4>
  ${buttons}
</div>`;
};

const injectIntoHtml = (html: string, section: string): string => {
  if (html.includes("</body>")) {
    return html.replace("</body>", section + "</body>");
  }
  return html + section;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildOutputDatasetsHtml", () => {
  it("single dataset: contains View LIBRARY.MEMBER label", () => {
    const html = buildOutputDatasetsHtml([
      { library: "WORK", member: "MYDATA" },
    ]);
    assert.include(html, "View WORK.MYDATA");
  });

  it("single dataset: contains postMessage call", () => {
    const html = buildOutputDatasetsHtml([
      { library: "WORK", member: "MYDATA" },
    ]);
    assert.include(html, "window._vsApi?.postMessage");
  });

  it("single dataset: postMessage contains correct library and member values", () => {
    const html = buildOutputDatasetsHtml([
      { library: "WORK", member: "MYDATA" },
    ]);
    assert.include(html, "library:'WORK'");
    assert.include(html, "member:'MYDATA'");
    assert.include(html, "type:'viewDataset'");
  });

  it("multiple datasets: contains both dataset buttons", () => {
    const html = buildOutputDatasetsHtml([
      { library: "WORK", member: "MYDATA" },
      { library: "SASLIB", member: "SALES" },
    ]);
    assert.include(html, "View WORK.MYDATA");
    assert.include(html, "View SASLIB.SALES");
  });

  it("multiple datasets: contains all postMessage values", () => {
    const html = buildOutputDatasetsHtml([
      { library: "WORK", member: "MYDATA" },
      { library: "SASLIB", member: "SALES" },
    ]);
    assert.include(html, "library:'WORK'");
    assert.include(html, "member:'MYDATA'");
    assert.include(html, "library:'SASLIB'");
    assert.include(html, "member:'SALES'");
  });

  it("escapes apostrophes in library name", () => {
    const html = buildOutputDatasetsHtml([
      { library: "LIB'S", member: "MYDATA" },
    ]);
    // The escaped version should use backslash-apostrophe inside the onclick string
    assert.include(html, "library:'LIB\\'S'");
    // A raw unescaped apostrophe inside the JS string literal would break parsing
    assert.notInclude(html, "library:'LIB'S'");
  });

  it("escapes apostrophes in member name", () => {
    const html = buildOutputDatasetsHtml([
      { library: "WORK", member: "MY'DATA" },
    ]);
    assert.include(html, "member:'MY\\'DATA'");
    assert.notInclude(html, "member:'MY'DATA'");
  });

  it("contains Output Datasets heading", () => {
    const html = buildOutputDatasetsHtml([
      { library: "WORK", member: "MYDATA" },
    ]);
    assert.include(html, "Output Datasets");
  });
});

describe("injectIntoHtml", () => {
  it("inserts section before </body> when present", () => {
    const html = "<html><body><p>content</p></body></html>";
    const section = "<div>injected</div>";
    const result = injectIntoHtml(html, section);
    assert.include(result, "<div>injected</div></body>");
    assert.ok(
      result.indexOf("<div>injected</div>") < result.indexOf("</body>"),
      "section should appear before </body>",
    );
  });

  it("appends section when html has no </body>", () => {
    const html = "<html><p>content</p></html>";
    const section = "<div>injected</div>";
    const result = injectIntoHtml(html, section);
    assert.ok(
      result.endsWith("<div>injected</div>"),
      "section should be appended at end",
    );
  });

  it("preserves all existing html content", () => {
    const html =
      "<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello world</p></body></html>";
    const section = "<div>datasets</div>";
    const result = injectIntoHtml(html, section);
    assert.include(result, "<!DOCTYPE html>");
    assert.include(result, "<title>Test</title>");
    assert.include(result, "<p>hello world</p>");
    assert.include(result, "<div>datasets</div>");
  });

  it("places section before </body> not after </html>", () => {
    const html = "<html><body><p>text</p></body></html>";
    const section = "<div>NEW</div>";
    const result = injectIntoHtml(html, section);
    const bodyCloseIdx = result.indexOf("</body>");
    const htmlCloseIdx = result.indexOf("</html>");
    const sectionIdx = result.indexOf("<div>NEW</div>");
    assert.ok(sectionIdx < bodyCloseIdx, "section must come before </body>");
    assert.ok(bodyCloseIdx < htmlCloseIdx, "</body> must come before </html>");
  });
});
