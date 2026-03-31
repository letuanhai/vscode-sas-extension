// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import axios, { AxiosError } from "axios";
import { l10n, window } from "vscode";

import { RunResult } from "..";
import { updateStatusBarItem } from "../../components/StatusBarItem";
import { ConnectionType } from "../../components/profile";
import { profileConfig } from "../../commands/profile";
import { Session } from "../session";
import {
  clearActiveCredentials,
  getAxios,
  getCachedState,
  getCredentials,
  setCachedState,
  setCredentials,
  setEncodeDoubleSlashes,
  setServerEncoding,
} from "./state";
import { Config } from "./types";
export type { Config };

let sessionInstance: StudioWebSession;

/**
 * Converts HTML log chunk to plain-text lines, preserving line breaks from
 * block-level elements before stripping all remaining tags.
 */
function stripHtml(html: string): string {
  return html
    .replace(/&nbsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/**
 * Determines the log line type from a plain text log line.
 */
function getLogLineType(
  line: string,
): "error" | "warning" | "note" | "normal" {
  if (/ERROR:/i.test(line)) {
    return "error";
  }
  if (/WARNING:/i.test(line)) {
    return "warning";
  }
  if (/NOTE:/i.test(line)) {
    return "note";
  }
  return "normal";
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Prompt user for an auth cookie. Returns undefined if cancelled, empty string if left blank. */
async function promptForCookie(): Promise<string | undefined> {
  return window.showInputBox({
    title: l10n.t("SAS Studio Auth Cookie"),
    placeHolder: l10n.t(
      "Enter auth cookie (leave blank for dev/local instance)",
    ),
    ignoreFocusOut: true,
    password: true,
  });
}

/** Prompt user for a session ID. Returns undefined if cancelled. */
async function promptForSessionId(): Promise<string | undefined> {
  return window.showInputBox({
    title: l10n.t("SAS Studio Session ID"),
    placeHolder: l10n.t("Enter your SAS Studio remote session ID"),
    ignoreFocusOut: true,
  });
}

/** Returns true if the HTTP status indicates an auth failure. */
function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Pings an existing session to check if it's still alive.
 * Returns "alive", "dead", or "auth_error".
 */
async function pingSession(
  endpoint: string,
  sessionId: string,
  cookieString?: string,
): Promise<"alive" | "dead" | "auth_error"> {
  try {
    const headers: Record<string, string> = {
      "RemoteSession-Id": sessionId,
      Accept: "*/*",
    };
    if (cookieString) {
      headers.Cookie = cookieString;
    }
    await axios.get(`${endpoint}/sasexec/sessions/${sessionId}/ping`, {
      headers,
      timeout: 15000,
    });
    return "alive";
  } catch (err) {
    if (err instanceof AxiosError && err.response) {
      if (err.response.status === 404) {
        return "dead";
      }
      if (isAuthError(err.response.status)) {
        return "auth_error";
      }
    }
    return "dead";
  }
}

/**
 * Creates a new session on the server.
 * Returns the session ID on success, or throws on auth/network error.
 */
async function createSessionOnServer(
  endpoint: string,
  cookieString?: string,
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookieString) {
    headers.Cookie = cookieString;
  }
  const { data } = await axios.post(
    `${endpoint}/sasexec/sessions`,
    {},
    { headers, timeout: 30000 },
  );
  if (!data?.id || typeof data.id !== "string") {
    throw new Error(l10n.t("Server returned no session ID."));
  }
  return data.id;
}

/**
 * Activates a session: sets credentials, updates cached state,
 * fetches server encoding, and updates the status bar.
 */
async function activateSession(
  endpoint: string,
  sessionId: string,
  cookieString?: string,
): Promise<void> {
  setCredentials({ endpoint, sessionId, cookieString });
  await setCachedState({ endpoint, sessionId, cookieString });

  const activeProfile = profileConfig.getActiveProfileDetail()?.profile;
  setEncodeDoubleSlashes(
    activeProfile?.connectionType === ConnectionType.StudioWeb
      ? (activeProfile.encodeDoubleSlashes ?? false)
      : false,
  );

  await fetchServerEncoding(sessionId);
  updateStatusBarItem(true);
}

// ---------------------------------------------------------------------------
// Core session management
// ---------------------------------------------------------------------------

/**
 * Ensures an active StudioWeb session is available. Tries (in order):
 *   1. Reuse active credentials if already set.
 *   2. Ping cached session → reactivate if alive.
 *   3. Create new session with cached cookie.
 *   4. Prompt user for a new cookie and create a session.
 */
async function ensureActiveSession(endpoint: string): Promise<void> {
  // 1. Already connected
  if (getCredentials()) {
    return;
  }

  const cached = await getCachedState();

  // 2. Try cached session
  if (cached?.sessionId && cached.endpoint === endpoint) {
    const status = await pingSession(
      endpoint,
      cached.sessionId,
      cached.cookieString,
    );
    if (status === "alive") {
      await activateSession(endpoint, cached.sessionId, cached.cookieString);
      return;
    }
    if (status === "auth_error") {
      // Cookie expired — need a new one
      const newCookie = await promptForCookie();
      if (newCookie === undefined) {
        throw new Error(l10n.t("SAS Studio auth cookie input was cancelled."));
      }
      // Try again with new cookie — session might still be alive
      const retryStatus = await pingSession(
        endpoint,
        cached.sessionId,
        newCookie || undefined,
      );
      if (retryStatus === "alive") {
        await activateSession(
          endpoint,
          cached.sessionId,
          newCookie || undefined,
        );
        return;
      }
      // Session dead, fall through to create with new cookie
      return createAndActivate(endpoint, newCookie || undefined);
    }
    // status === "dead" — try to create a new session with cached cookie
    try {
      return await createAndActivate(
        endpoint,
        cached.cookieString,
      );
    } catch (err) {
      if (
        err instanceof AxiosError &&
        err.response &&
        isAuthError(err.response.status)
      ) {
        // Cookie expired — prompt and retry
        return promptCookieAndCreate(endpoint);
      }
      throw err;
    }
  }

  // 3. No cached session — try creating with cached cookie if available
  if (cached?.cookieString && cached.endpoint === endpoint) {
    try {
      return await createAndActivate(endpoint, cached.cookieString);
    } catch (err) {
      if (
        err instanceof AxiosError &&
        err.response &&
        isAuthError(err.response.status)
      ) {
        return promptCookieAndCreate(endpoint);
      }
      throw err;
    }
  }

  // 4. No cached state at all — prompt for cookie
  return promptCookieAndCreate(endpoint);
}

/** Prompt for cookie, create session, and activate. */
async function promptCookieAndCreate(endpoint: string): Promise<void> {
  const cookie = await promptForCookie();
  if (cookie === undefined) {
    throw new Error(l10n.t("SAS Studio auth cookie input was cancelled."));
  }
  return createAndActivate(endpoint, cookie || undefined);
}

/** Create a new session on the server and activate it. */
async function createAndActivate(
  endpoint: string,
  cookieString?: string,
): Promise<void> {
  const sessionId = await createSessionOnServer(endpoint, cookieString);
  await activateSession(endpoint, sessionId, cookieString);
}

// ---------------------------------------------------------------------------
// Session class
// ---------------------------------------------------------------------------

export class StudioWebSession extends Session {
  private _config: Config;
  private _cancelled = false;
  private _submissionId: string | undefined;

  public set config(value: Config) {
    this._config = value;
  }

  public get configEndpoint(): string | undefined {
    return this._config?.endpoint;
  }

  protected async establishConnection(): Promise<void> {
    await ensureActiveSession(this._config.endpoint);
  }

  protected async _run(code: string): Promise<RunResult> {
    const axiosInstance = getAxios();
    const credentials = getCredentials();

    if (!axiosInstance || !credentials) {
      throw new Error(l10n.t("No active SAS Studio session."));
    }

    this._cancelled = false;
    this._submissionId = undefined;
    const { sessionId } = credentials;

    const { data: submission } = await axiosInstance.post(
      `/sessions/${sessionId}/asyncSubmissions`,
      code,
      {
        params: { label: "Program", uri: "Program" },
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
        _silent: true, // errors bubble to run.ts onRunError
      },
    );
    // asyncSubmissions returns a bare UUID string, not an object
    this._submissionId = submission;

    // Poll for results
    let runResult: RunResult = {};
    let done = false;

    while (!done && !this._cancelled) {
      const { data: messages } = await axiosInstance.get(
        `/sessions/${sessionId}/messages/longpoll`,
        { _silent: true }, // errors bubble to run.ts onRunError
      );

      // Empty array means execution ended
      if (!messages || messages.length === 0) {
        break;
      }

      for (const message of messages) {
        const { messageType, payload } = message;

        if (messageType === "LogChunk" || messageType === "LogEnd") {
          if (payload?.chunk) {
            const plainText = stripHtml(payload.chunk);
            const lines = plainText
              .split("\n")
              .filter((line: string) => line.trim() !== "")
              .map((line: string) => ({
                type: getLogLineType(line),
                line,
              }));

            if (lines.length > 0) {
              this._onExecutionLogFn?.(lines);
            }
          }
        } else if (messageType === "SubmitComplete") {
          const resultsLink = payload?.links?.find(
            (link: { rel: string; uri: string }) => link.rel === "results",
          );

          if (resultsLink?.uri) {
            try {
              const resultsUrl = `${credentials.endpoint}${resultsLink.uri}`;

              const { data: htmlContent } = await axiosInstance.get(resultsUrl);

              if (typeof htmlContent === "string" && htmlContent.trim()) {
                runResult = { html5: htmlContent, title: "Result" };
              }
            } catch (err) {
              console.error("[StudioWeb] failed to fetch results:", err);
            }
          }

          const dataSets: Array<{ member: string; library: string }> =
            payload?.dataSets ?? [];
          if (dataSets.length > 0) {
            const dataSetLines = dataSets.map(({ library, member }) => ({
              type: "note" as const,
              line: `NOTE: Output dataset: ${library}.${member}`,
            }));
            this._onExecutionLogFn?.(dataSetLines);
            runResult = {
              ...runResult,
              dataSets: dataSets.map(({ library, member }) => ({
                library,
                member,
              })),
            };
          }

          done = true;
          break;
        }
      }
    }

    this._submissionId = undefined;
    return runResult;
  }

  protected async _close(): Promise<void> {
    // Clear active connection but preserve cached state for reconnect
    clearActiveCredentials();
    updateStatusBarItem(false);

    if (this._rejectRun) {
      this._rejectRun({ message: l10n.t("The SAS session has closed.") });
      this._rejectRun = undefined;
    }
  }

  public async cancel(): Promise<void> {
    this._cancelled = true;

    const axiosInstance = getAxios();
    const credentials = getCredentials();

    if (axiosInstance && credentials && this._submissionId) {
      try {
        await axiosInstance.delete(
          `/sessions/${credentials.sessionId}/submissions`,
          { params: { id: this._submissionId } },
        );
      } catch {
        // Ignore errors on cancel
      }
    }
  }

  public sessionId(): string | undefined {
    return getCredentials()?.sessionId;
  }
}

/**
 * Fetches the server's default text encoding preference and stores it in state.
 * Non-fatal: keeps default UTF-8 if the request fails.
 */
async function fetchServerEncoding(sessionId: string): Promise<void> {
  try {
    const axiosInstance = getAxios();
    if (axiosInstance) {
      const prefsResp = await axiosInstance.get(
        `/${sessionId}/preferences/get`,
        { params: { key: "SWE.optionPreferencesGeneral.key" } },
      );
      const enc: string = prefsResp.data?.defaultTextEncoding;
      if (enc) {
        setServerEncoding(enc);
      }
    }
  } catch {
    // Non-fatal: keep default UTF-8
  }
}

/**
 * Ensures credentials are set, prompting the user if they are not.
 * Returns true if credentials are available after the call, false if the user cancelled.
 */
export async function ensureCredentials(): Promise<boolean> {
  if (getCredentials()) {
    return true;
  }

  const activeProfileDetail = profileConfig.getActiveProfileDetail();
  const profile = activeProfileDetail?.profile;
  const endpoint =
    profile?.connectionType === ConnectionType.StudioWeb
      ? profile.endpoint
      : (sessionInstance?.configEndpoint ?? "");

  if (!endpoint) {
    return false;
  }

  try {
    await ensureActiveSession(endpoint);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a new session on the server using the stored auth cookie.
 * If no cookie is cached, prompts the user for one.
 * Does NOT ask for a session ID — it is obtained from the server.
 */
export async function promptNewSession(): Promise<void> {
  const cachedForEndpoint = await getCachedState();
  const endpoint =
    getCredentials()?.endpoint ??
    cachedForEndpoint?.endpoint ??
    sessionInstance?.configEndpoint ??
    "";

  if (!endpoint) {
    return;
  }

  // Clear active connection
  clearActiveCredentials();

  // Try to reuse cached cookie
  const cookieString =
    cachedForEndpoint?.endpoint === endpoint
      ? cachedForEndpoint.cookieString
      : undefined;

  if (cookieString !== undefined) {
    try {
      await createAndActivate(endpoint, cookieString);
      return;
    } catch (err) {
      if (
        err instanceof AxiosError &&
        err.response &&
        isAuthError(err.response.status)
      ) {
        // Cookie expired — fall through to prompt
      } else {
        throw err;
      }
    }
  }

  // No cached cookie or it expired — prompt
  await promptCookieAndCreate(endpoint);
}

/**
 * Attaches to an existing session by prompting the user for both
 * a session ID and an auth cookie. Validates the session with ping
 * before activating. Provides backward compatibility with the
 * original manual-entry flow.
 */
export async function promptAttachSession(): Promise<void> {
  const cachedForEndpoint = await getCachedState();
  const endpoint =
    getCredentials()?.endpoint ??
    cachedForEndpoint?.endpoint ??
    sessionInstance?.configEndpoint ??
    "";

  if (!endpoint) {
    return;
  }

  const sessionId = await promptForSessionId();
  if (sessionId === undefined) {
    return;
  }

  const cookieString = await promptForCookie();
  if (cookieString === undefined) {
    return;
  }

  // Validate the session is alive
  const status = await pingSession(
    endpoint,
    sessionId,
    cookieString || undefined,
  );

  if (status === "dead") {
    window.showErrorMessage(
      l10n.t("Session not found or no longer alive."),
    );
    return;
  }
  if (status === "auth_error") {
    window.showErrorMessage(
      l10n.t("Authentication failed. Check your auth cookie."),
    );
    return;
  }

  // Clear any existing connection and activate the attached session
  clearActiveCredentials();
  await activateSession(endpoint, sessionId, cookieString || undefined);
}

/**
 * Returns the singleton `StudioWebSession` instance, creating it if needed.
 */
export function getSession(config: Config): Session {
  if (!sessionInstance) {
    sessionInstance = new StudioWebSession();
  }
  sessionInstance.config = config;
  return sessionInstance;
}
