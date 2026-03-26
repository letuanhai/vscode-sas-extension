// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tests for StudioWebSession._run(): poll loop, log extraction, HTML result fetch.
import { expect } from "chai";
import * as sinon from "sinon";

import * as state from "../../src/connection/studioweb/state";

describe("StudioWebSession — _run poll loop and log extraction", () => {
  let sandbox: sinon.SinonSandbox;
  let axiosMock: {
    post: sinon.SinonStub;
    get: sinon.SinonStub;
    defaults: { baseURL: string };
    interceptors: { response: { use: sinon.SinonStub } };
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    axiosMock = {
      post: sinon.stub(),
      get: sinon.stub(),
      defaults: { baseURL: "http://sas.test/sasexec" },
      interceptors: { response: { use: sinon.stub() } },
    };

    state.setCredentials({
      endpoint: "http://sas.test",
      sessionId: "sess-run",
    });
    sandbox.stub(state, "getAxios").returns(axiosMock as never);
  });

  afterEach(() => {
    state.setCredentials(undefined);
    sandbox.restore();
  });

  it("calls _onExecutionLogFn with NOTE type for NOTE: lines in LogChunk", async () => {
    axiosMock.post.resolves({ data: "sub-001" });
    axiosMock.get
      .onFirstCall()
      .resolves({
        data: [
          {
            messageType: "LogChunk",
            payload: { chunk: "<p>NOTE: foo bar</p>" },
          },
        ],
      })
      .onSecondCall()
      .resolves({
        data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
      });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();

    const logLines: Array<{ type: string; line: string }>[] = [];
    session.onExecutionLogFn = (
      lines: { type: string; line: string }[],
    ) => {
      logLines.push(lines);
    };

    await session._run("data _null_; run;");

    const flat = logLines.flat();
    const noteLine = flat.find((l) => l.line.includes("NOTE: foo bar"));
    expect(noteLine, "expected NOTE: line in log").to.not.be.undefined;
    expect(noteLine!.type).to.equal("note");
  });

  it("stops polling and resolves when longpoll returns empty array", async () => {
    axiosMock.post.resolves({ data: "sub-002" });
    // Empty array signals end of execution
    axiosMock.get.resolves({ data: [] });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const result = await session._run("data _null_; run;");

    expect(axiosMock.get.callCount).to.equal(1);
    expect(result).to.deep.equal({});
  });

  it("fetches HTML result when SubmitComplete has a results link", async () => {
    axiosMock.post.resolves({ data: "sub-003" });
    // First get: longpoll returns SubmitComplete with results link
    axiosMock.get
      .onFirstCall()
      .resolves({
        data: [
          {
            messageType: "SubmitComplete",
            payload: {
              links: [{ rel: "results", uri: "/SASStudio/38/results/abc" }],
            },
          },
        ],
      })
      // Second get: actual HTML content fetch
      .onSecondCall()
      .resolves({ data: "<html><body>output</body></html>" });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const result = await session._run("proc print data=sashelp.class; run;");

    expect(result).to.deep.equal({
      html5: "<html><body>output</body></html>",
      title: "Result",
    });
  });

  it("returns empty object when SubmitComplete has no links", async () => {
    axiosMock.post.resolves({ data: "sub-004" });
    axiosMock.get.resolves({
      data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
    });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const result = await session._run("data _null_; run;");

    expect(result).to.deep.equal({});
  });

  it("emits NOTE lines for dataSets in SubmitComplete payload", async () => {
    axiosMock.post.resolves({ data: "sub-005" });
    axiosMock.get.resolves({
      data: [
        {
          messageType: "SubmitComplete",
          payload: {
            links: [],
            dataSets: [{ library: "WORK", member: "MYDATA" }],
          },
        },
      ],
    });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logLines: Array<{ type: string; line: string }>[] = [];
    session.onExecutionLogFn = (
      lines: { type: string; line: string }[],
    ) => {
      logLines.push(lines);
    };

    await session._run("data work.mydata; run;");

    const flat = logLines.flat();
    const datasetLine = flat.find((l) =>
      l.line.includes("NOTE: Output dataset: WORK.MYDATA"),
    );
    expect(datasetLine, "expected dataset NOTE line").to.not.be.undefined;
    expect(datasetLine!.type).to.equal("note");
  });

  it("classifies ERROR: lines as type 'error'", async () => {
    axiosMock.post.resolves({ data: "sub-006" });
    axiosMock.get
      .onFirstCall()
      .resolves({
        data: [
          {
            messageType: "LogChunk",
            payload: {
              chunk: "<p>ERROR: File not found</p>",
            },
          },
        ],
      })
      .onSecondCall()
      .resolves({
        data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
      });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logLines: Array<{ type: string; line: string }>[] = [];
    session.onExecutionLogFn = (
      lines: { type: string; line: string }[],
    ) => {
      logLines.push(lines);
    };

    await session._run("bad code;");

    const flat = logLines.flat();
    const errorLine = flat.find((l) => l.type === "error");
    expect(errorLine, "expected an error-type log line").to.not.be.undefined;
  });

  it("classifies WARNING: lines as type 'warning'", async () => {
    axiosMock.post.resolves({ data: "sub-007" });
    axiosMock.get
      .onFirstCall()
      .resolves({
        data: [
          {
            messageType: "LogChunk",
            payload: { chunk: "WARNING: something happened" },
          },
        ],
      })
      .onSecondCall()
      .resolves({
        data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
      });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logLines: Array<{ type: string; line: string }>[] = [];
    session.onExecutionLogFn = (
      lines: { type: string; line: string }[],
    ) => {
      logLines.push(lines);
    };

    await session._run("code;");

    const flat = logLines.flat();
    const warnLine = flat.find((l) => l.type === "warning");
    expect(warnLine, "expected a warning-type log line").to.not.be.undefined;
  });

  it("classifies lines without prefix as type 'normal'", async () => {
    axiosMock.post.resolves({ data: "sub-008" });
    axiosMock.get
      .onFirstCall()
      .resolves({
        data: [
          {
            messageType: "LogChunk",
            payload: { chunk: "Just a regular log line" },
          },
        ],
      })
      .onSecondCall()
      .resolves({
        data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
      });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logLines: Array<{ type: string; line: string }>[] = [];
    session.onExecutionLogFn = (
      lines: { type: string; line: string }[],
    ) => {
      logLines.push(lines);
    };

    await session._run("code;");

    const flat = logLines.flat();
    const normalLine = flat.find((l) => l.type === "normal");
    expect(normalLine, "expected a normal-type log line").to.not.be.undefined;
  });

  it("accumulates multiple LogChunk messages before SubmitComplete", async () => {
    axiosMock.post.resolves({ data: "sub-009" });
    axiosMock.get
      .onFirstCall()
      .resolves({
        data: [
          {
            messageType: "LogChunk",
            payload: { chunk: "NOTE: chunk one" },
          },
          {
            messageType: "LogChunk",
            payload: { chunk: "NOTE: chunk two" },
          },
        ],
      })
      .onSecondCall()
      .resolves({
        data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
      });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const logCalls: number[] = [];
    session.onExecutionLogFn = (
      lines: { type: string; line: string }[],
    ) => {
      logCalls.push(lines.length);
    };

    await session._run("code;");

    // _onExecutionLogFn was called twice (once per LogChunk)
    expect(logCalls.length).to.equal(2);
  });

  it("strips HTML from log chunk before calling _onExecutionLogFn", async () => {
    axiosMock.post.resolves({ data: "sub-010" });
    axiosMock.get
      .onFirstCall()
      .resolves({
        data: [
          {
            messageType: "LogChunk",
            payload: {
              chunk:
                '<span class="note">NOTE: result=&lt;ok&gt;</span>',
            },
          },
        ],
      })
      .onSecondCall()
      .resolves({
        data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
      });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    const lines: { type: string; line: string }[] = [];
    session.onExecutionLogFn = (
      ls: { type: string; line: string }[],
    ) => lines.push(...ls);

    await session._run("code;");

    // HTML tags stripped; entity decoded
    const line = lines.find((l) => l.line.includes("NOTE: result=<ok>"));
    expect(line, "HTML should be stripped and entity decoded").to.not.be
      .undefined;
  });

  it("clears _submissionId after _run completes", async () => {
    axiosMock.post.resolves({ data: "sub-011" });
    axiosMock.get.resolves({
      data: [{ messageType: "SubmitComplete", payload: { links: [] } }],
    });

    const { StudioWebSession } = await import(
      "../../src/connection/studioweb/index"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = new (StudioWebSession as any)();
    await session._run("data _null_; run;");

    expect(session._submissionId).to.be.undefined;
  });
});
