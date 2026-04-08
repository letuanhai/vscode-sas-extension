import concurrently from "concurrently";
import esbuild from "esbuild";
import fs from "fs";

const args = process.argv.slice(2);
const dev = args.includes("dev");
const target = args.find((a) => a.startsWith("--target="))?.split("=")[1];

const plugins = [
  {
    name: "watch-plugin",
    setup(build) {
      build.onEnd((result) => {
        // for VS Code task tracking
        console.log("start");
        console.log("end");
      });
    },
  },
];

const commonBuildOptions = {
  bundle: true,
  outdir: ".",
  external: ["vscode"],
  loader: {
    ".properties": "text",
    ".node": "copy",
    ".svg": "dataurl",
  },
  sourcemap: !!dev,
  minify: !dev,
  plugins: dev ? plugins : [],
  define: {
    "process.env.NODE_ENV": dev ? `"development"` : `"production"`,
  },
};

const nodeBuildOptions = {
  ...commonBuildOptions,
  entryPoints: {
    "./client/dist/node/extension": "./client/src/node/extension.ts",
    "./server/dist/node/server": "./server/src/node/server.ts",
  },
  platform: "node",
};

const browserBuildOptions = {
  ...commonBuildOptions,
  format: "esm",
  entryPoints: {
    "./client/dist/webview/DataViewer": "./client/src/webview/DataViewer.tsx",
    "./client/dist/webview/TablePropertiesViewer":
      "./client/src/webview/TablePropertiesViewer.ts",
    "./client/dist/notebook/LogRenderer":
      "./client/src/components/notebook/renderers/LogRenderer.ts",
    "./client/dist/notebook/HTMLRenderer":
      "./client/src/components/notebook/renderers/HTMLRenderer.ts",
  },
};

// Process KaTeX CSS - embed fonts as base64 data URIs for self-contained HTML
const copyKatexCss = () => {
  let katexCss = fs.readFileSync(
    "./client/node_modules/katex/dist/katex.min.css",
    "utf8",
  );

  const katexFontsDir = "./client/node_modules/katex/dist/fonts";

  // Find all font file references in the CSS
  const fontRegex = /url\(fonts\/([\w-]+\.(woff2|woff|ttf))\)/g;
  let match;
  const fontReplacements = new Map();

  while ((match = fontRegex.exec(katexCss)) !== null) {
    const fontFile = match[1];
    if (!fontReplacements.has(fontFile)) {
      const fontPath = `${katexFontsDir}/${fontFile}`;
      if (fs.existsSync(fontPath)) {
        const fontData = fs.readFileSync(fontPath);
        const base64 = fontData.toString("base64");
        const mimeType = fontFile.endsWith(".woff2")
          ? "font/woff2"
          : fontFile.endsWith(".woff")
            ? "font/woff"
            : "font/ttf";
        fontReplacements.set(fontFile, `data:${mimeType};base64,${base64}`);
      }
    }
  }

  // Replace all font URLs with data URIs
  fontReplacements.forEach((dataUri, fontFile) => {
    katexCss = katexCss.replace(
      new RegExp(`fonts/${fontFile.replace(/\./g, "\\.")}`, "g"),
      dataUri,
    );
  });

  fs.writeFileSync(
    "./client/dist/notebook/exporters/templates/katex.css",
    katexCss,
  );
};

const copyFiles = (filter = null) => {
  const foldersToCopy = [
    {
      src: "./client/src/components/notebook/exporters/templates",
      dest: "./client/dist/notebook/exporters/templates",
    },
    {
      src: "./client/src/connection/itc/script",
      dest: "./client/dist/node",
    },
  ];
  const filteredFoldersToCopy =
    filter === null
      ? foldersToCopy
      : foldersToCopy.filter((folder) => folder.src === filter);

  if (filter) {
    console.log(`Copying files matching "${filter}"`);
  } else {
    console.log("Copying files");
  }

  filteredFoldersToCopy.map((item) =>
    fs.cpSync(item.src, item.dest, { recursive: true, force: true }),
  );

  copyKatexCss();
  console.log("Files copied");
};

const staticFilesToWatch = ["./client/src/connection/itc/script"];

if (target === "static") {
  copyFiles();
  if (dev) {
    staticFilesToWatch.forEach((pathToWatch) =>
      fs.watch(pathToWatch, () => copyFiles(pathToWatch)),
    );
  }
} else if (target === "webviews" || target === "client") {
  const ctx = await esbuild.context(
    target === "webviews" ? browserBuildOptions : nodeBuildOptions,
  );
  await ctx.rebuild();

  if (dev) {
    await ctx.watch();
  } else {
    await ctx.dispose();
  }
} else {
  const { result } = concurrently([
    {
      command: `node ./tools/build.mjs ${dev ? "dev" : ""} --target=webviews`,
      name: "browser",
      prefixColor: "magenta",
    },
    {
      command: `node ./tools/build.mjs ${dev ? "dev" : ""} --target=client`,
      name: "node",
      prefixColor: "cyan",
    },
    {
      command: `node ./tools/build.mjs ${dev ? "dev" : ""} --target=static`,
      name: "static",
      prefixColor: "green",
    },
  ]);
  await result.then(
    () => {},
    () => console.error("Concurrently failed to run"),
  );
}
