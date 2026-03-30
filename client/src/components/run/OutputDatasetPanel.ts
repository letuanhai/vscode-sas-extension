// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Disposable, Uri, commands } from "vscode";

import { getResultPanelWebview, showResult } from "../ResultPanel";
import LibraryModel from "../LibraryNavigator/LibraryModel";
import { LibraryItem } from "../LibraryNavigator/types";
import StudioWebLibraryAdapter from "../../connection/studioweb/StudioWebLibraryAdapter";

// Dispose the previous listener before registering a new one to prevent accumulation.
let _messageHandlerDisposable: Disposable | undefined;

export const buildOutputDatasetsHtml = (
  dataSets: Array<{ library: string; member: string }>,
): string => {
  const buttons = dataSets
    .map(({ library, member }) => {
      // Use JSON.stringify for safe serialization, then HTML-encode double-quotes
      // so the value is valid inside an HTML attribute (double-quote delimited).
      const payload = JSON.stringify({ type: "viewDataset", library, member }).replace(
        /"/g,
        "&quot;",
      );
      return `<button
  type="button"
  aria-label="View dataset ${library}.${member}"
  style="margin: 0 8px 4px 0; padding: 4px 12px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px;"
  onmouseover="this.style.background='var(--vscode-button-hoverBackground)'"
  onmouseout="this.style.background='var(--vscode-button-background)'"
  onclick="window._vsApi?.postMessage(${payload})"
>View ${library}.${member}</button>`;
    })
    .join("\n");

  return `<div style="padding: 12px 16px; font-family: var(--vscode-font-family); color: var(--vscode-foreground);">
  <h4 style="margin: 0 0 8px;">Output Datasets</h4>
  ${buttons}
</div>`;
};

export const injectIntoHtml = (html: string, section: string): string => {
  // Inject at the top of <body> so the section appears above SAS output.
  const match = /<body[^>]*>/i.exec(html);
  if (match) {
    const insertPos = match.index + match[0].length;
    return html.slice(0, insertPos) + section + html.slice(insertPos);
  }
  return section + html;
};

export const showOutputDatasets = (
  html: string | undefined,
  dataSets: Array<{ library: string; member: string }>,
  uri?: Uri,
  title?: string,
): void => {
  if (dataSets.length === 0) {
    if (html !== undefined) {
      showResult(html, uri, title);
    }
    return;
  }

  const section = buildOutputDatasetsHtml(dataSets);
  // The trailing space in `<body ` is required: wrapPanelHtml searches for
  // "<body " (with space) to inject the vscode-context attribute.
  const EMPTY_HTML =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body ></body></html>';
  const base = html ?? EMPTY_HTML;
  const finalHtml = injectIntoHtml(base, section);
  showResult(finalHtml, uri, title);

  const webview = getResultPanelWebview();
  if (!webview) {
    return;
  }

  _messageHandlerDisposable?.dispose();
  _messageHandlerDisposable = webview.onDidReceiveMessage(
    async (message: { type: string; library: string; member: string }) => {
      if (message.type !== "viewDataset") {
        return;
      }
      const { library, member } = message;
      const adapter = new StudioWebLibraryAdapter();
      const item: LibraryItem = {
        uid: `${library}.${member}`,
        id: member,
        name: member,
        library,
        type: "table",
        readOnly: false,
      };
      const model = new LibraryModel(adapter);
      try {
        await commands.executeCommand(
          "SAS.viewTable",
          item,
          model.getTableResultSet(item),
          () => model.fetchColumns(item),
          () => model.getTableRowCount(item),
        );
      } catch {
        // SAS.viewTable is optional (only registered for studioweb connections);
        // silently ignore if unavailable.
      }
    },
  );
};
