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

describeIfLive("StudioWeb Live UI — Server Navigator", function () {
  this.timeout(120000);

  before(async () => {
    await bootstrapStudioWebProfile();
    await sleep(1000);
  });

  after(async () => {
    await cleanupProfile();
  });

  it("serverdataprovider.focus command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "serverdataprovider.focus");
  });

  it("SAS.server.refreshContent command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.refreshContent");
  });

  it("SAS.server.addFileResource command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.addFileResource");
  });

  it("SAS.server.addFolderResource command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.addFolderResource");
  });

  it("SAS.server.deleteResource command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.deleteResource");
  });

  it("SAS.server.renameResource command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.renameResource");
  });

  it("SAS.server.copyPath command exists", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.copyPath");
  });
});
