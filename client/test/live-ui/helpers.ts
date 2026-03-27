// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Shared helpers for live-ui integration tests that run inside the VS Code
// extension host against the real SAS Studio dev server.
import { ConfigurationTarget, commands, extensions, workspace } from "vscode";

import * as sinon from "sinon";

import {
  EXTENSION_CONFIG_KEY,
  EXTENSION_DEFINE_PROFILES_CONFIG_KEY,
} from "../../src/components/profile";

const EXTENSION_ID = "SAS.sas-lsp";

const LIVE = process.env.SAS_UI_LIVE === "1";

const LIVE_PROFILE_NAME = "live-test";
const LIVE_ENDPOINT =
  process.env.SAS_UI_LIVE_ENDPOINT || "http://192.168.0.141/SASStudio/38";

/**
 * Conditional `describe` — runs only when `SAS_UI_LIVE=1` is set,
 * otherwise the entire suite is skipped.
 */
export const describeIfLive = (LIVE ? describe : describe.skip) as Mocha.SuiteFunction;

/**
 * Normalise a SAS Studio endpoint by stripping a trailing `/sasexec`.
 */
export function normalizeEndpoint(url: string): string {
  return url.replace(/\/sasexec\/?$/, "");
}

/**
 * Ensure the SAS extension is activated. The extension only auto-activates
 * on `onLanguage:sas` etc., so tests must trigger activation explicitly.
 */
export async function ensureExtensionActive(): Promise<void> {
  const ext = extensions.getExtension(EXTENSION_ID);
  if (ext && !ext.isActive) {
    await ext.activate();
  }
}

/**
 * Write a studioweb profile into VS Code settings and make it active.
 * The dev instance requires no authorization cookie.
 * Ensures the extension is activated and waits for the config change to propagate.
 */
export async function bootstrapStudioWebProfile(): Promise<void> {
  await ensureExtensionActive();
  const endpoint = normalizeEndpoint(LIVE_ENDPOINT);
  await workspace.getConfiguration(EXTENSION_CONFIG_KEY).update(
    EXTENSION_DEFINE_PROFILES_CONFIG_KEY,
    {
      activeProfile: LIVE_PROFILE_NAME,
      profiles: {
        [LIVE_PROFILE_NAME]: {
          connectionType: "studioweb",
          endpoint,
        },
      },
    },
    ConfigurationTarget.Global,
  );
  // Wait for the extension to process the config change and update adapters
  await sleep(2000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Remove the live-test profile and close the session.
 */
export async function cleanupProfile(): Promise<void> {
  await commands.executeCommand("SAS.close", true);
  await workspace.getConfiguration(EXTENSION_CONFIG_KEY).update(
    EXTENSION_DEFINE_PROFILES_CONFIG_KEY,
    undefined,
    ConfigurationTarget.Global,
  );
}

/**
 * Poll until `predicate` returns true, checking every `intervalMs`.
 * Rejects after `timeoutMs` with an optional message.
 */
export function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
  intervalMs = 100,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = async () => {
      if (await predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

export interface SetContextCall {
  key: string;
  value: unknown;
}

/**
 * Intercept `commands.executeCommand("setContext", ...)` calls and record
 * them while forwarding all other commands to the real implementation.
 * Call `restore()` when done to remove the stub.
 */
export function recordSetContext(): {
  calls: SetContextCall[];
  restore: () => void;
} {
  const calls: SetContextCall[] = [];
  const originalExec = commands.executeCommand;
  const stub = sinon.stub(commands, "executeCommand").callsFake(
    async (...args: unknown[]) => {
      if (args[0] === "setContext") {
        calls.push({ key: args[1] as string, value: args[2] });
        return undefined;
      }
      return (originalExec as Function).apply(commands, args);
    },
  );

  return {
    calls,
    restore: () => stub.restore(),
  };
}
