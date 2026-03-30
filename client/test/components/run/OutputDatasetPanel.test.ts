// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Webview, WebviewPanel, commands, window } from "vscode";

import { assert } from "chai";
import * as sinon from "sinon";

import * as ExtensionContext from "../../../src/components/ExtensionContext";
import * as settings from "../../../src/components/utils/settings";
import { showOutputDatasets } from "../../../src/components/run/OutputDatasetPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake WebviewPanel suitable for stubbing window.createWebviewPanel. */
function makeFakeWebviewPanel(): {
  panel: WebviewPanel;
  webview: { html: string; onDidReceiveMessage: sinon.SinonStub; postMessage: sinon.SinonStub };
  fireMessage: (msg: unknown) => void;
} {
  let messageHandler: ((msg: unknown) => void) | undefined;
  let disposeCallback: (() => void) | undefined;

  const webview = {
    html: "",
    onDidReceiveMessage: sinon
      .stub()
      .callsFake((handler: (msg: unknown) => void) => {
        messageHandler = handler;
        return { dispose: () => {} };
      }),
    postMessage: sinon.stub(),
  };

  const panel = {
    webview: webview as unknown as Webview,
    title: "",
    onDidDispose: (cb: () => void) => {
      disposeCallback = cb;
      return { dispose: () => {} };
    },
    reveal: sinon.stub(),
    dispose: () => {
      disposeCallback?.();
    },
  } as unknown as WebviewPanel;

  return {
    panel,
    webview,
    fireMessage: (msg: unknown) => messageHandler?.(msg),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("showOutputDatasets (integration)", function () {
  this.timeout(10000);

  let sandbox: sinon.SinonSandbox;
  let createWebviewPanelStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let fakePanel: ReturnType<typeof makeFakeWebviewPanel>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Stub settings so ResultPanel doesn't try to read real VS Code config
    sandbox.stub(settings, "isSinglePanelEnabled").returns(undefined as any);
    sandbox.stub(settings, "isSideResultEnabled").returns(undefined as any);

    // Stub setContextValue to avoid needing a real extension context
    sandbox.stub(ExtensionContext, "setContextValue").resolves();

    // Build a fresh fake panel for each test
    fakePanel = makeFakeWebviewPanel();

    // Stub window.createWebviewPanel to return our fake panel
    createWebviewPanelStub = sandbox
      .stub(window, "createWebviewPanel")
      .returns(fakePanel.panel);

    // Stub commands.executeCommand — intercept SAS.viewTable; forward others
    const originalExec = commands.executeCommand;
    executeCommandStub = sandbox
      .stub(commands, "executeCommand")
      .callsFake(async (...args: unknown[]) => {
        if (args[0] === "SAS.viewTable") {
          // Captured for assertions — don't forward
          return undefined;
        }
        // Forward everything else (e.g., setContext)
        return (originalExec as Function).apply(commands, args);
      });
  });

  afterEach(() => {
    // Dispose the panel so ResultPanel's internal state is reset between tests
    fakePanel.panel.dispose();
    sandbox.restore();
  });

  // -------------------------------------------------------------------------
  // a) no datasets + html provided
  // -------------------------------------------------------------------------
  it("no datasets + html: creates webview panel with original html", () => {
    const originalHtml =
      "<!DOCTYPE html><html><head></head><body><p>results</p></body></html>";

    showOutputDatasets(originalHtml, []);

    assert.isTrue(
      createWebviewPanelStub.calledOnce,
      "createWebviewPanel should be called once",
    );
    assert.include(
      fakePanel.webview.html,
      "<p>results</p>",
      "webview html should contain original content",
    );
    assert.notInclude(
      fakePanel.webview.html,
      "Output Datasets",
      "should NOT inject Output Datasets section when dataSets is empty",
    );
  });

  // -------------------------------------------------------------------------
  // b) no datasets + no html: no-op
  // -------------------------------------------------------------------------
  it("no datasets + no html: does not create a webview panel", () => {
    showOutputDatasets(undefined, []);

    assert.isTrue(
      createWebviewPanelStub.notCalled,
      "createWebviewPanel should NOT be called",
    );
  });

  // -------------------------------------------------------------------------
  // c) datasets + html provided: injects section alongside original content
  // -------------------------------------------------------------------------
  it("datasets + html: webview html contains Output Datasets and original content", () => {
    const originalHtml =
      "<!DOCTYPE html><html><head></head><body><p>results</p></body></html>";

    showOutputDatasets(originalHtml, [{ library: "WORK", member: "MYDATA" }]);

    assert.isTrue(
      createWebviewPanelStub.calledOnce,
      "createWebviewPanel should be called once",
    );
    assert.include(
      fakePanel.webview.html,
      "Output Datasets",
      "webview html should include Output Datasets heading",
    );
    assert.include(
      fakePanel.webview.html,
      "View WORK.MYDATA",
      "webview html should include View button for dataset",
    );
    assert.include(
      fakePanel.webview.html,
      "<p>results</p>",
      "webview html should retain original content",
    );
  });

  // -------------------------------------------------------------------------
  // d) datasets + no html: uses empty skeleton
  // -------------------------------------------------------------------------
  it("datasets + no html: creates webview with Output Datasets section", () => {
    showOutputDatasets(undefined, [{ library: "WORK", member: "MYDATA" }]);

    assert.isTrue(
      createWebviewPanelStub.calledOnce,
      "createWebviewPanel should be called once",
    );
    assert.include(
      fakePanel.webview.html,
      "Output Datasets",
      "webview html should include Output Datasets heading",
    );
    assert.include(
      fakePanel.webview.html,
      "View WORK.MYDATA",
      "webview html should include View button for dataset",
    );
  });

  // -------------------------------------------------------------------------
  // e) clicking View button fires viewDataset message → SAS.viewTable called
  // -------------------------------------------------------------------------
  it("viewDataset message calls SAS.viewTable with correct LibraryItem", async () => {
    showOutputDatasets(undefined, [{ library: "WORK", member: "MYDATA" }]);

    // Simulate the webview sending a viewDataset message
    fakePanel.fireMessage({
      type: "viewDataset",
      library: "WORK",
      member: "MYDATA",
    });

    // Let the async message handler complete
    await new Promise((r) => setTimeout(r, 0));

    const viewTableCall = executeCommandStub
      .getCalls()
      .find((c) => c.args[0] === "SAS.viewTable");

    assert.isDefined(viewTableCall, "SAS.viewTable should have been called");

    const item = viewTableCall!.args[1];
    assert.equal(item.uid, "WORK.MYDATA", "uid should be LIBRARY.MEMBER");
    assert.equal(item.library, "WORK", "library should match");
    assert.equal(item.id, "MYDATA", "id should be the member name");
    assert.equal(item.name, "MYDATA", "name should be the member name");
    assert.equal(item.type, "table", "type should be 'table'");
  });

  // -------------------------------------------------------------------------
  // f) non-viewDataset messages are ignored
  // -------------------------------------------------------------------------
  it("non-viewDataset message does not call SAS.viewTable", async () => {
    showOutputDatasets(undefined, [{ library: "WORK", member: "MYDATA" }]);

    // Fire an unrelated message type
    fakePanel.fireMessage({ type: "other", library: "WORK", member: "MYDATA" });

    await new Promise((r) => setTimeout(r, 0));

    const viewTableCall = executeCommandStub
      .getCalls()
      .find((c) => c.args[0] === "SAS.viewTable");

    assert.isUndefined(
      viewTableCall,
      "SAS.viewTable should NOT be called for non-viewDataset messages",
    );
  });
});
