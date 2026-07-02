// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Uri, ViewColumn, WebviewPanel, l10n, window } from "vscode";

import { v4 } from "uuid";

import { getContextValue, setContextValue } from "../ExtensionContext";
import {
  getPanelMode,
  isAutofocusResultsEnabled,
  isSideResultEnabled,
} from "../utils/settings";

const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
export const SAS_RESULT_PANEL = "SASResultPanel";

interface ResultPanelState {
  panelId: string;
}

interface IdentifiableWebviewPanel {
  webviewPanel: WebviewPanel;
  panelId: string;
}

let resultPanel: IdentifiableWebviewPanel | undefined; // singlePanel mode
const resultPanels = new Map<string, IdentifiableWebviewPanel>(); // perScript mode
let lastShownPanel: IdentifiableWebviewPanel | undefined; // always = most recently shown

const createPanel = (title: string, sideResult: unknown, panelId: string): IdentifiableWebviewPanel => {
  const webviewPanel = window.createWebviewPanel(
    SAS_RESULT_PANEL,
    title,
    { preserveFocus: true, viewColumn: sideResult ? ViewColumn.Beside : ViewColumn.Active },
    { enableScripts: true, enableFindWidget: true },
  );
  webviewPanel.onDidDispose(() => disposePanel(panelId));
  return { webviewPanel, panelId };
};

export const showResult = (html: string, uri?: Uri, title?: string) => {
  const sideResult = isSideResultEnabled();
  const panelMode = getPanelMode();
  const focusResults = isAutofocusResultsEnabled();

  if (!title) {
    title = l10n.t("Result");
  }

  let current: IdentifiableWebviewPanel | undefined;

  if (panelMode === "single") {
    current = resultPanel;
  } else if (panelMode === "per-script") {
    current = resultPanels.get(title);
  }

  let panelId: string;

  if (!current) {
    panelId = `${v4()}`;
    current = createPanel(title, sideResult, panelId);
    if (panelMode === "single") {
      resultPanel = current;
    } else if (panelMode === "per-script") {
      resultPanels.set(title, current);
    }
  } else {
    panelId = current.panelId;
    const editor = uri
      ? window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === uri.toString(),
      )
      : window.activeTextEditor;
    if (current.webviewPanel.title !== title) {
      current.webviewPanel.title = title;
    }
    if (focusResults) {
      current.webviewPanel.reveal(
        sideResult ? ViewColumn.Beside : editor?.viewColumn,
        true,
      );
    }
  }

  const panelHtml = wrapPanelHtml(html, panelId);
  current.webviewPanel.webview.html = panelHtml;
  setContextValue(panelId, panelHtml);
  lastShownPanel = current;
};

const wrapPanelHtml = (html: string, panelId: string): string => {
  return (
    html
      // Inject vscode context into our results html body
      .replace(
        "<body ",
        `<body data-vscode-context='${JSON.stringify({
          preventDefaultContextMenuItems: true,
          panelId,
        })}' `,
      )
      // Make sure the html and body take up the full height of the parent
      // iframe so that the context menu is clickable anywhere on the page
      .replace(
        "</head>",
        `<script language="javascript">
          if(acquireVsCodeApi){
            window._vsApi = acquireVsCodeApi();
            const panelId = '${panelId}'
            window._vsApi.setState({panelId});
          }
         </script>
         <style>
           html,body { height: 100% !important; }
           /* Auto dark/light mode: match VS Code's active color theme.
              !important is required to override inline background-color/color
              that SAS-generated HTML sets directly on <body>. */
           body.vscode-dark  { color-scheme: dark  !important; background-color: var(--vscode-editor-background, #1e1e1e) !important; color: var(--vscode-editor-foreground, #cccccc) !important; }
           body.vscode-light { color-scheme: light !important; background-color: var(--vscode-editor-background, #ffffff) !important; color: var(--vscode-editor-foreground, #000000) !important; }
           body.vscode-high-contrast { color-scheme: dark !important; background-color: var(--vscode-editor-background, #000000) !important; color: var(--vscode-editor-foreground, #ffffff) !important; }
         </style></head>`,
      )
  );
};

export const deserializeWebviewPanel = async (
  webviewPanel: WebviewPanel,
  state: ResultPanelState,
): Promise<void> => {
  const panelHtml: string = await getContextValue(state.panelId);
  const restored: IdentifiableWebviewPanel = { panelId: state.panelId, webviewPanel };
  resultPanel = restored;
  resultPanels.set(webviewPanel.title, restored);
  lastShownPanel = restored;
  webviewPanel.webview.html = panelHtml;
  webviewPanel.onDidDispose(() => disposePanel(state.panelId));
};

export const fetchHtmlFor = async (panelId: string) => {
  let panelHtml: string = "";
  panelHtml = await getContextValue(panelId);
  panelHtml = panelHtml.replace(SCRIPT_REGEX, "");

  return panelHtml;
};

export const getResultPanelWebview = (): import("vscode").Webview | undefined => {
  return lastShownPanel?.webviewPanel.webview;
};

const disposePanel = (id: string) => {
  if (resultPanel?.panelId === id) {
    resultPanel = undefined;
  }
  for (const [key, panel] of resultPanels.entries()) {
    if (panel.panelId === id) {
      resultPanels.delete(key);
      break;
    }
  }
  if (lastShownPanel?.panelId === id) {
    lastShownPanel = undefined;
  }
  setContextValue(id, undefined);
};
