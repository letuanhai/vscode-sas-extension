// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { commands } from "vscode";

import { assert } from "chai";

import {
  bootstrapStudioWebProfile,
  cleanupProfile,
  describeIfLive,
} from "./helpers";

describeIfLive("StudioWeb Live UI — Activation", function () {
  this.timeout(60000);

  before(async () => {
    await bootstrapStudioWebProfile();
  });

  after(async () => {
    await cleanupProfile();
  });

  it("registers server quickBrowse command", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.quickBrowse");
  });

  it("registers quickBrowseReveal command", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.server.quickBrowseReveal");
  });

  it("registers SAS.studioweb.newSession command", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.studioweb.newSession");
  });

  it("registers SAS.studioweb.attachSession command", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.studioweb.attachSession");
  });

  it("registers SAS.run command", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.run");
  });

  it("registers SAS.close command", async () => {
    const allCommands = await commands.getCommands(true);
    assert.include(allCommands, "SAS.close");
  });
});
