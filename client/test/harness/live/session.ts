// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Shared live-session helper for harness integration tests.
// Only use when LIVE_SERVER=1 — requires a running SAS Studio instance.
import axios, { AxiosInstance } from "axios";

export const LIVE_ENDPOINT = "http://192.168.0.141/SASStudio/38";
export const LIVE_BASE = `${LIVE_ENDPOINT}/sasexec`;

export interface LiveSession {
  sessionId: string;
  endpoint: string;
  axios: AxiosInstance;
}

/**
 * Create a new SAS Studio session on the dev server.
 * The dev instance requires no authorization cookie.
 */
export async function createLiveSession(): Promise<LiveSession> {
  const { data } = await axios.post(
    `${LIVE_BASE}/sessions`,
    {},
    {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    },
  );

  const sessionId = data.id as string;
  if (!sessionId) {
    throw new Error(`Server returned no session ID: ${JSON.stringify(data)}`);
  }

  const ax = axios.create({
    baseURL: LIVE_BASE,
    headers: {
      "RemoteSession-Id": sessionId,
      "Content-Type": "application/json",
    },
    timeout: 60000,
  });

  return { sessionId, endpoint: LIVE_ENDPOINT, axios: ax };
}

/**
 * Delete a SAS Studio session, freeing server resources.
 * Call this in `after()` / `afterEach()` hooks.
 */
export async function deleteLiveSession(sessionId: string): Promise<void> {
  try {
    await axios.delete(`${LIVE_BASE}/sessions/${sessionId}`, {
      headers: { "RemoteSession-Id": sessionId },
      timeout: 15000,
    });
  } catch {
    // Best-effort — ignore errors on cleanup
  }
}
