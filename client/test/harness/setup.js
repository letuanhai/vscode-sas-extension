// Minimal vscode shim for the Mocha harness.
// Intercepts "vscode" module resolution and returns a lightweight mock so that
// extension source files can be required in a plain Node.js/ts-node process.
"use strict";

const Module = require("module");
const path = require("path");

// ---------- Uri shim ----------
class Uri {
  constructor(scheme, authority, uriPath, query, fragment) {
    this.scheme = scheme || "";
    this.authority = authority || "";
    this.path = uriPath || "";
    this.query = query || "";
    this.fragment = fragment || "";
    this.fsPath = uriPath || "";
  }
  toString() {
    let s = `${this.scheme}:`;
    if (this.authority) s += `//${this.authority}`;
    s += this.path;
    if (this.query) s += `?${this.query}`;
    if (this.fragment) s += `#${this.fragment}`;
    return s;
  }
  with(change) {
    return new Uri(
      "scheme" in change ? change.scheme : this.scheme,
      "authority" in change ? change.authority : this.authority,
      "path" in change ? change.path : this.path,
      "query" in change ? change.query : this.query,
      "fragment" in change ? change.fragment : this.fragment,
    );
  }
  static parse(str) {
    const match =
      /^([a-zA-Z][a-zA-Z0-9+\-.]*):([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(
        str,
      );
    if (match) {
      const scheme = match[1];
      const rest = match[2] || "";
      const query = match[3] || "";
      const authority = rest.startsWith("//")
        ? rest.slice(2).split("/")[0]
        : "";
      const uriPath = rest.startsWith("//")
        ? rest.slice(2 + authority.length)
        : rest;
      return new Uri(scheme, authority, uriPath, query, "");
    }
    return new Uri("", "", str, "", "");
  }
  static from(components) {
    return new Uri(
      components.scheme || "",
      components.authority || "",
      components.path || "",
      components.query || "",
      components.fragment || "",
    );
  }
  static joinPath(base, ...segments) {
    const joined = [base.path, ...segments].join("/").replace(/\/+/g, "/");
    return base.with({ path: joined });
  }
  static file(p) {
    return new Uri("file", "", p, "", "");
  }
}

// ---------- FileType enum ----------
const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

// ---------- ThemeIcon ----------
class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
  static File = new (class ThemeIconStatic {
    constructor() {
      this.id = "file";
    }
  })();
}

// ---------- TreeItemCollapsibleState ----------
const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

// ---------- SnippetString ----------
class SnippetString {
  constructor(value) {
    this.value = value || "";
  }
}

// ---------- Tab / TabInput stubs ----------
class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}
class TabInputNotebook {
  constructor(uri) {
    this.uri = uri;
  }
}

// ---------- Minimal window ----------
const window = {
  showInputBox: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  createStatusBarItem: () => ({
    show: () => {},
    hide: () => {},
    dispose: () => {},
    text: "",
    tooltip: "",
  }),
  tabGroups: {
    all: [],
    close: () => Promise.resolve(true),
  },
};

// ---------- l10n ----------
const l10n = {
  t: (str, ...args) => {
    if (typeof str !== "string") return String(str);
    return str.replace(/\{(\w+)\}/g, (_, key) => {
      const idx = parseInt(key, 10);
      if (!isNaN(idx)) return String(args[idx] ?? `{${key}}`);
      const obj = args[0];
      return obj && typeof obj === "object"
        ? String(obj[key] ?? `{${key}}`)
        : `{${key}}`;
    });
  },
};

// ---------- commands ----------
const commands = {
  executeCommand: () => Promise.resolve(undefined),
  registerCommand: () => ({ dispose: () => {} }),
  registerTextEditorCommand: () => ({ dispose: () => {} }),
};

// ---------- authentication ----------
const authentication = {
  getSession: () => Promise.resolve(undefined),
  registerAuthenticationProvider: () => ({ dispose: () => {} }),
  onDidChangeSessions: () => ({ dispose: () => {} }),
};

// ---------- workspace ----------
const workspace = {
  getConfiguration: () => ({ get: () => undefined, has: () => false }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

// ---------- EventEmitter ----------
class EventEmitter {
  constructor() {
    this._listeners = [];
    this.event = (listener) => {
      this._listeners.push(listener);
      return { dispose: () => {} };
    };
  }
  fire(data) {
    this._listeners.forEach((l) => l(data));
  }
  dispose() {
    this._listeners = [];
  }
}

// ---------- StatusBarAlignment ----------
const StatusBarAlignment = { Left: 1, Right: 2 };

// ---------- vscode mock object ----------
const vscodeMock = {
  Uri,
  FileType,
  ThemeIcon,
  TreeItemCollapsibleState,
  SnippetString,
  TabInputText,
  TabInputNotebook,
  window,
  l10n,
  commands,
  authentication,
  workspace,
  EventEmitter,
  StatusBarAlignment,
};

// ---------- node/extension.ts shim ----------
// The harness tests import state.ts which transitively imports node/extension.ts.
// That module loads vscode-languageclient/node and many other VS Code APIs that
// are unavailable outside the extension host. We stub the module entirely so
// only the exported values needed by state.ts (extensionContext) are exposed.
const nodeExtensionMock = {
  extensionContext: undefined,
  // Export other top-level symbols accessed by production code under test
  profileConfig: {
    getActiveProfileDetail: () => undefined,
  },
};

// ---------- Hook module resolution ----------
// Store the fake modules so require.cache references work
const FAKE_PATH = path.join(__dirname, "__vscode_shim__.js");
const FAKE_NODE_EXT_PATH = path.join(__dirname, "__node_extension_shim__.js");

const makeShimEntry = (fakePath, exports) => ({
  id: fakePath,
  filename: fakePath,
  loaded: true,
  exports,
  paths: [],
  parent: null,
  children: [],
});

// Pre-populate require.cache with our shims at fake paths
require.cache[FAKE_PATH] = makeShimEntry(FAKE_PATH, vscodeMock);
require.cache[FAKE_NODE_EXT_PATH] = makeShimEntry(FAKE_NODE_EXT_PATH, nodeExtensionMock);

// Absolute path of the real node/extension.ts (resolved without extension).
// We intercept any require() for this file and redirect it to our shim.
const NODE_EXT_REAL_PATH = path.resolve(
  __dirname,
  "../../src/node/extension",
);

// Intercept resolution of "vscode" and node/extension.ts
const originalResolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parentModule, isMain, options) {
  if (request === "vscode") {
    return FAKE_PATH;
  }
  // Intercept node/extension.ts however it's required (relative or absolute).
  // normalise by resolving from the requesting module's directory.
  try {
    const resolved = originalResolveFilename(request, parentModule, isMain, options);
    // Match the real node/extension.ts file (with or without .ts extension)
    if (
      resolved === NODE_EXT_REAL_PATH + ".ts" ||
      resolved === NODE_EXT_REAL_PATH + ".js" ||
      resolved === NODE_EXT_REAL_PATH
    ) {
      return FAKE_NODE_EXT_PATH;
    }
    return resolved;
  } catch (e) {
    // If original resolution fails (e.g. missing module), fall through —
    // the error will surface naturally when the module is actually required.
    throw e;
  }
};
