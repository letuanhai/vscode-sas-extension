// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  getEncodeDoubleSlashes,
  getServerEncoding,
  setCredentials,
  setEncodeDoubleSlashes,
  setServerEncoding,
} from "../../src/connection/studioweb/state";

describe("StudioWeb state — encoding", () => {
  afterEach(() => {
    // Resetting credentials also resets encoding state
    setCredentials(undefined);
  });

  describe("getServerEncoding / setServerEncoding", () => {
    it("defaults to UTF-8 before any set", () => {
      expect(getServerEncoding()).to.equal("UTF-8");
    });

    it("returns value after setServerEncoding", () => {
      setServerEncoding("ISO-8859-1");
      expect(getServerEncoding()).to.equal("ISO-8859-1");
    });

    it("resets to UTF-8 when empty string is passed", () => {
      setServerEncoding("ISO-8859-1");
      setServerEncoding("");
      expect(getServerEncoding()).to.equal("UTF-8");
    });

    it("is reset to UTF-8 when setCredentials(undefined) is called", () => {
      // setCredentials with creds sets up state; clearing it resets encoding
      setCredentials({
        endpoint: "http://sas.test",
        sessionId: "sess-enc",
      });
      setServerEncoding("EUC-JP");
      setCredentials(undefined);
      expect(getServerEncoding()).to.equal("UTF-8");
    });
  });

  describe("getEncodeDoubleSlashes / setEncodeDoubleSlashes", () => {
    it("defaults to false before any set", () => {
      expect(getEncodeDoubleSlashes()).to.equal(false);
    });

    it("returns true after setEncodeDoubleSlashes(true)", () => {
      setCredentials({
        endpoint: "http://sas.test",
        sessionId: "sess-enc2",
      });
      setEncodeDoubleSlashes(true);
      expect(getEncodeDoubleSlashes()).to.equal(true);
    });

    it("is reset to false when setCredentials(undefined) is called", () => {
      setCredentials({
        endpoint: "http://sas.test",
        sessionId: "sess-enc3",
      });
      setEncodeDoubleSlashes(true);
      setCredentials(undefined);
      expect(getEncodeDoubleSlashes()).to.equal(false);
    });
  });
});
