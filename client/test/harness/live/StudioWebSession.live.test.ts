// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Live E2E tests for StudioWebSession.
// Requires LIVE_SERVER=1 and a running SAS Studio instance at 192.168.0.141.
import { expect } from "chai";
import * as sinon from "sinon";

import * as state from "../../../src/connection/studioweb/state";
import { StudioWebSession } from "../../../src/connection/studioweb/index";
import { LIVE_ENDPOINT, LiveSession, createLiveSession, deleteLiveSession } from "./session";

const LIVE = process.env.LIVE_SERVER === "1";
const maybeIt = LIVE ? it : it.skip;

describe("StudioWebSession — live E2E", function () {
  this.timeout(60000);

  let liveSession: LiveSession;
  let sandbox: sinon.SinonSandbox;

  before(async function () {
    if (!LIVE) return;
    liveSession = await createLiveSession();
    // Set up state so StudioWebSession._run() can use the real session
    state.setCredentials({
      endpoint: LIVE_ENDPOINT,
      sessionId: liveSession.sessionId,
    });
  });

  after(async function () {
    state.setCredentials(undefined);
    if (!LIVE || !liveSession) return;
    await deleteLiveSession(liveSession.sessionId);
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  maybeIt("session creation returns a valid ID", async () => {
    expect(liveSession.sessionId).to.be.a("string").that.is.not.empty;
  });

  maybeIt("ping returns alive for a valid session", async () => {
    const { data } = await liveSession.axios.get(
      `/sessions/${liveSession.sessionId}/ping`,
    );
    expect(data).to.have.property("running");
    expect(data).to.have.property("queued");
  });

  maybeIt("ping returns 404 for a fabricated session ID", async () => {
    let status: number | undefined;
    try {
      await liveSession.axios.get(
        `/sessions/00000000-dead-beef-0000-000000000000/ping`,
      );
    } catch (err: unknown) {
      status = (err as { response?: { status: number } }).response?.status;
    }
    expect(status).to.equal(404);
  });

  // ---------------------------------------------------------------------------
  // Code execution
  // ---------------------------------------------------------------------------

  maybeIt("submits code and polls to SubmitComplete", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logs: { type: string; line: string }[][] = [];
    session.onExecutionLogFn = (lines: { type: string; line: string }[]) =>
      logs.push(lines);

    await session._run("data _null_; put 'HELLO'; run;");

    const flat = logs.flat();
    expect(flat.length).to.be.at.least(1);
  });

  maybeIt("log extraction — NOTE lines appear in log after execution", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logs: { type: string; line: string }[][] = [];
    session.onExecutionLogFn = (lines: { type: string; line: string }[]) =>
      logs.push(lines);

    await session._run("%put NOTE: result=3;");

    const flat = logs.flat();
    const noteLine = flat.find((l) => l.line.includes("NOTE: result=3"));
    expect(noteLine, "expected NOTE: result=3 in log").to.not.be.undefined;
  });

  maybeIt("invalid code produces an ERROR: log line", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logs: { type: string; line: string }[][] = [];
    session.onExecutionLogFn = (lines: { type: string; line: string }[]) =>
      logs.push(lines);

    // Reference a nonexistent dataset to force an ERROR log line
    await session._run(
      "proc print data=work.nonexistent_dataset_xyz; run;",
    );

    const flat = logs.flat();
    const errorLine = flat.find((l) => l.type === "error");
    expect(errorLine, "expected an error log line").to.not.be.undefined;
  });

  maybeIt("proc print produces HTML output result", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();

    const result = await session._run(
      "proc print data=sashelp.class(obs=3); run;",
    );

    // SubmitComplete should have a results link that resolves to HTML
    expect(result).to.have.property("html5").that.is.a("string").that.is.not
      .empty;
  });

  maybeIt("cancel stops a long-running submission", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();

    // Start a 10-second sleep — don't await it
    const runPromise = session._run(
      "data _null_; call sleep(10, 1); run;",
    );

    // Wait until the POST has been sent and submission ID is captured
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (session._submissionId !== undefined) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });

    // Cancel the submission
    await session.cancel();

    // The run should resolve (either to {} or throw, but not hang)
    const result = await Promise.race([
      runPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("run did not resolve after cancel")), 8000),
      ),
    ]);

    // Result after cancel is an empty object
    expect(result).to.deep.equal({});
  });
});
