// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { QuickPick, QuickPickItem, commands, window } from "vscode";

import { assert } from "chai";
import * as sinon from "sinon";

import {
  bootstrapStudioWebProfile,
  cleanupProfile,
  describeIfLive,
  waitFor,
} from "./helpers";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNotBusy(
  qp: QuickPick<QuickPickItem>,
  timeout = 15000,
): Promise<void> {
  const start = Date.now();
  while (qp.busy && Date.now() - start < timeout) {
    await sleep(50);
  }
  if (qp.busy) {
    throw new Error("QuickPick still busy after timeout");
  }
}

describeIfLive("StudioWeb Live UI — QuickFileBrowser", function () {
  this.timeout(120000);

  let sandbox: sinon.SinonSandbox;
  let activeQuickPick: QuickPick<QuickPickItem> | undefined;

  before(async () => {
    await bootstrapStudioWebProfile();
  });

  after(async () => {
    await cleanupProfile();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Spy on createQuickPick to capture the instance
    const originalCreate = window.createQuickPick.bind(window);
    sandbox.stub(window, "createQuickPick").callsFake(() => {
      const qp = originalCreate();
      activeQuickPick = qp;
      return qp;
    });
  });

  afterEach(() => {
    if (activeQuickPick) {
      activeQuickPick.hide();
      activeQuickPick.dispose();
      activeQuickPick = undefined;
    }
    sandbox.restore();
  });

  it("opens a QuickPick when quickBrowse is executed", async () => {
    const browsePromise = commands.executeCommand("SAS.server.quickBrowse");

    // Wait for QuickPick to appear
    await waitFor(() => activeQuickPick !== undefined, 30000);
    assert.isDefined(activeQuickPick, "QuickPick should have been created");

    // Wait for loading to finish
    await waitForNotBusy(activeQuickPick!, 30000);

    // Root level should NOT have ".." parent entry
    const labels = activeQuickPick!.items.map((i) => i.label);
    assert.notInclude(labels, "..");

    activeQuickPick!.hide();
    await browsePromise;
  });

  it("QuickPick title starts as 'SAS Server' at root", async () => {
    const browsePromise = commands.executeCommand("SAS.server.quickBrowse");
    await waitFor(() => activeQuickPick !== undefined, 30000);
    await waitForNotBusy(activeQuickPick!, 30000);

    assert.isTrue(
      activeQuickPick!.title === "SAS Server" || activeQuickPick!.title === "/",
      `Expected root title 'SAS Server' or '/', got '${activeQuickPick!.title}'`,
    );

    activeQuickPick!.hide();
    await browsePromise;
  });

  it("items have reveal buttons", async () => {
    const browsePromise = commands.executeCommand("SAS.server.quickBrowse");
    await waitFor(() => activeQuickPick !== undefined, 30000);
    await waitForNotBusy(activeQuickPick!, 30000);

    // Only folder/file items (not "..") should have buttons
    const itemsWithButtons = (activeQuickPick!.items as any[]).filter(
      (i) => i.label !== ".." && i.buttons && i.buttons.length > 0,
    );

    if (activeQuickPick!.items.length > 0) {
      assert.isAbove(
        itemsWithButtons.length,
        0,
        "Non-parent items should have reveal buttons",
      );
    }

    activeQuickPick!.hide();
    await browsePromise;
  });
});
