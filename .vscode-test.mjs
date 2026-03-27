import { defineConfig } from "@vscode/test-cli";

export default defineConfig([
  {
    label: "integration",
    files: "client/out/test/**/*.test.js",
    extensionDevelopmentPath: ".",
    launchArgs: ["--disable-extensions", "--locale", "en-US"],
    mocha: {
      timeout: 100000,
      ui: "bdd",
    },
  },
  {
    label: "studioweb-live-ui",
    files: "client/out/test/live-ui/**/*.live.test.js",
    extensionDevelopmentPath: ".",
    launchArgs: ["--disable-extensions", "--locale", "en-US"],
    mocha: {
      timeout: 120000,
      ui: "bdd",
    },
  },
]);
