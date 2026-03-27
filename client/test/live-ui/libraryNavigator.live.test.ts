// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { commands } from "vscode";

import { assert } from "chai";

import {
  bootstrapStudioWebProfile,
  cleanupProfile,
  describeIfLive,
} from "./helpers";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeIfLive("StudioWeb Live UI — Library Navigator", function () {
  this.timeout(120000);

  before(async () => {
    await bootstrapStudioWebProfile();
    await sleep(1000);
  });

  after(async () => {
    await cleanupProfile();
  });

  it("librarydataprovider.focus command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "librarydataprovider.focus");
  });

  it("SAS.refreshLibraries command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.refreshLibraries");
  });

  it("SAS.collapseAllLibraries command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.collapseAllLibraries");
  });

  it("SAS.viewTable command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.viewTable");
  });

  it("SAS.deleteTable command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.deleteTable");
  });

  it("SAS.downloadTable command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.downloadTable");
  });

  it("SAS.showTableProperties command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.showTableProperties");
  });
});
