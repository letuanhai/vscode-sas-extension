// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import axios, { AxiosError, AxiosInstance } from "axios";
import { window } from "vscode";

import { getSecretStorage } from "../../components/ExtensionContext";
import { extensionContext } from "../../node/extension";

// Allow callers to mark a request as silent so the global error interceptor
// does not show a notification for it (use for requests that have dedicated
// error handling, e.g. code-execution errors handled by onRunError).
declare module "axios" {
  interface AxiosRequestConfig {
    _silent?: boolean;
  }
}

export interface StudioWebCredentials {
  endpoint: string; // e.g. https://sas8.example.com
  sessionId: string;
  cookieString?: string; // raw Cookie header value; omitted/empty for dev instances
}

/**
 * Cached state that survives close/reconnect cycles and VS Code restarts.
 * The session ID is stored in globalState; the auth cookie is stored in
 * SecretStorage (OS keychain).
 */
export interface StudioWebCachedState {
  endpoint: string;
  sessionId?: string;
  cookieString?: string;
}

const GLOBAL_STATE_KEY = "studioweb.cachedSession";
const SECRET_STORAGE_NAMESPACE = "studioweb.auth";
const SECRET_KEY_COOKIE = "cookie";

let _credentials: StudioWebCredentials | undefined;
let _axios: AxiosInstance | undefined;
let _controller: AbortController | undefined;
let _serverEncoding = "UTF-8";
let _encodeDoubleSlashes = false;

export function getCredentials(): StudioWebCredentials | undefined {
  return _credentials;
}

export function getAxios(): AxiosInstance | undefined {
  return _axios;
}

/**
 * Loads the cached state from globalState (session ID + endpoint) and
 * SecretStorage (auth cookie). Returns undefined if nothing was persisted.
 */
export async function getCachedState(): Promise<
  StudioWebCachedState | undefined
> {
  const ctx = extensionContext;
  if (!ctx) {
    return undefined;
  }

  const persisted = ctx.globalState.get<{
    endpoint: string;
    sessionId?: string;
  }>(GLOBAL_STATE_KEY);

  if (!persisted) {
    return undefined;
  }

  const secretStorage = getSecretStorage(SECRET_STORAGE_NAMESPACE);
  const cookieString = await secretStorage.get(SECRET_KEY_COOKIE);

  return {
    endpoint: persisted.endpoint,
    sessionId: persisted.sessionId,
    cookieString: cookieString ?? undefined,
  };
}

/**
 * Persists the cached state: session ID + endpoint to globalState,
 * auth cookie to SecretStorage.
 */
export async function setCachedState(
  state: StudioWebCachedState | undefined,
): Promise<void> {
  const ctx = extensionContext;
  if (!ctx) {
    return;
  }

  if (state) {
    await ctx.globalState.update(GLOBAL_STATE_KEY, {
      endpoint: state.endpoint,
      sessionId: state.sessionId,
    });

    const secretStorage = getSecretStorage(SECRET_STORAGE_NAMESPACE);
    if (state.cookieString) {
      await secretStorage.store(SECRET_KEY_COOKIE, state.cookieString);
    }
  } else {
    await ctx.globalState.update(GLOBAL_STATE_KEY, undefined);
    const secretStorage = getSecretStorage(SECRET_STORAGE_NAMESPACE);
    await secretStorage.store(SECRET_KEY_COOKIE, "");
  }
}

/** Returns the server's default text encoding (e.g. "UTF-8", "ISO-8859-1"). */
export function getServerEncoding(): string {
  return _serverEncoding;
}

/** Sets the server's default text encoding. Call after fetching session preferences. */
export function setServerEncoding(encoding: string): void {
  _serverEncoding = encoding || "UTF-8";
}

/** Returns whether double slashes in workspace URLs should be encoded as /~~ds~~. */
export function getEncodeDoubleSlashes(): boolean {
  return _encodeDoubleSlashes;
}

/** Sets whether double slashes in workspace URLs should be encoded as /~~ds~~. */
export function setEncodeDoubleSlashes(value: boolean): void {
  _encodeDoubleSlashes = value;
}

/**
 * Sets the active credentials and creates the shared axios instance.
 * Pass `undefined` to tear down the active connection only (cached state
 * is preserved for reconnect).
 */
export function setCredentials(creds: StudioWebCredentials | undefined): void {
  // Cancel any in-flight requests from the previous session
  _controller?.abort();
  _controller = undefined;

  _credentials = creds;
  if (creds) {
    _controller = new AbortController();
    const controller = _controller;

    const headers: Record<string, string> = {
      "RemoteSession-Id": creds.sessionId,
    };
    if (creds.cookieString) {
      headers.Cookie = creds.cookieString;
    }

    _axios = axios.create({
      baseURL: `${creds.endpoint}/sasexec`,
      headers,
      timeout: 30000,
    });
    // Attach abort signal so all requests on this instance can be cancelled together
    _axios.interceptors.request.use((config) => {
      config.signal = controller.signal;
      return config;
    });

    // Show an error notification for any HTTP error response, unless the
    // request was cancelled or marked silent by the caller.
    _axios.interceptors.response.use(undefined, (error: unknown) => {
      const isCancel =
        axios.isCancel(error) ||
        (error instanceof Error &&
          (error.name === "AbortError" || error.name === "CanceledError"));
      const isSilent =
        error instanceof AxiosError && error.config?._silent === true;

      if (
        !isCancel &&
        !isSilent &&
        error instanceof AxiosError &&
        error.response
      ) {
        const { status, data } = error.response;
        const method = error.config?.method?.toUpperCase() ?? "REQUEST";
        const url = error.config?.url ?? "";
        const detail =
          typeof data === "string"
            ? data.slice(0, 200)
            : typeof data === "object" &&
                data !== null &&
                "message" in data &&
                typeof data.message === "string"
              ? data.message
              : "";
        window.showErrorMessage(
          `HTTP ${status} error on ${method} ${url}${detail ? ": " + detail : ""}`,
        );
      }
      return Promise.reject(error);
    });
  } else {
    _axios = undefined;
    _serverEncoding = "UTF-8";
    _encodeDoubleSlashes = false;
  }
}

/**
 * Clears active credentials and the axios instance without touching
 * the persisted cached state. Used by `_close()` so that reconnect
 * can reuse the cached cookie/session.
 */
export function clearActiveCredentials(): void {
  setCredentials(undefined);
}
