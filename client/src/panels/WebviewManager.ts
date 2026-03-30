// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Disposable, Uri, ViewColumn, WebviewPanel, window } from "vscode";

export class WebViewManager {
  public panels: Record<string, WebView> = {};

  public render(webview: WebView, uid: string, forceReRender: boolean = false) {
    if (this.panels[uid]) {
      if (forceReRender) {
        // Keep the existing VS Code panel to preserve tab position.
        // Detach old handlers, attach new ones, then tell the running React app
        // to reset its state.  Replacing panel.webview.html is intentionally
        // skipped because retainContextWhenHidden prevents it from resetting
        // the JS context on a live tab.
        const existing = this.panels[uid];
        const existingPanel = existing.getPanel();
        existing.detach();
        webview.onDispose = () => delete this.panels[uid];
        this.panels[uid] = webview.withPanel(existingPanel);
        existingPanel.webview.postMessage({ command: "reset" });
        return;
      } else {
        this.panels[uid].display();
        return;
      }
    }

    const panel = window.createWebviewPanel(
      webview.getViewType(),
      uid,
      ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    webview.onDispose = () => delete this.panels[uid];
    this.panels[uid] = webview.withPanel(panel).render();
  }
}

export abstract class WebView {
  protected panel: WebviewPanel;
  protected readonly _disposables: Disposable[] = [];
  private _onDispose: () => void;

  public constructor(
    protected readonly extensionUri: Uri,
    protected readonly title: string,
  ) {}

  set onDispose(disposeCallback: () => void) {
    this._onDispose = disposeCallback;
  }

  public getViewType(): string {
    return "webView";
  }

  abstract body(): string;
  abstract l10nMessages?(): Record<string, string>;
  abstract scripts?(): string[];
  abstract styles?(): string[];
  public render(): WebView {
    const policies = [
      `default-src 'none';`,
      `font-src ${this.panel.webview.cspSource} data:;`,
      `img-src ${this.panel.webview.cspSource} data:;`,
      `script-src ${this.panel.webview.cspSource};`,
      `style-src ${this.panel.webview.cspSource};`,
    ];
    const styles = (this?.styles() || [])
      .map(
        (style) =>
          `<link rel="stylesheet" href="${this.webviewUri(
            this.extensionUri,
            style,
          )}">`,
      )
      .join("");
    const scripts = (this?.scripts() || [])
      .map(
        (script) =>
          `<script type="module" src="${this.webviewUri(
            this.extensionUri,
            script,
          )}"></script>`,
      )
      .join("");

    this.panel.webview.html = `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="${policies.join(
            " ",
          )}" />
          ${styles}
          <title>${this.title}</title>
        </head>
        <body data-l10n='${JSON.stringify(this.l10nMessages ? this.l10nMessages() : {})}'>
          ${this.body()}
          ${scripts}
        </body>
      </html>`;

    return this;
  }

  abstract processMessage(event: Event): void;

  public withPanel(webviewPanel: WebviewPanel): WebView {
    this.panel = webviewPanel;
    this._disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage(this.processMessage.bind(this)),
    );
    this.onPanelAttached();
    return this;
  }

  // Override in subclasses to react when a panel is (re-)attached.
  // Subclasses should push any additional listeners onto this._disposables.
  protected onPanelAttached(): void {}

  // Dispose all subscriptions without closing the panel itself.
  // Used before forceReRender to cleanly hand the panel to a new WebView instance.
  public detach(): void {
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      disposable?.dispose();
    }
  }

  public getPanel() {
    return this.panel;
  }

  public dispose() {
    this.panel.dispose();
    this.detach();
    this._onDispose && this._onDispose();
  }

  public display() {
    this.panel.reveal(ViewColumn.One);
  }

  public webviewUri(extensionUri: Uri, name: string): Uri {
    return this.panel.webview.asWebviewUri(
      Uri.joinPath(extensionUri, "client", "dist", "webview", name),
    );
  }
}
