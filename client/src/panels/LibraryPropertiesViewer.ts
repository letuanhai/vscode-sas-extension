// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Uri, l10n } from "vscode";

import { LibraryInfo } from "../components/LibraryNavigator/types";
import { WebView } from "./WebviewManager";

class LibraryPropertiesViewer extends WebView {
  l10nMessages = undefined;

  constructor(
    extensionUri: Uri,
    private readonly libraryInfo: LibraryInfo,
  ) {
    super(extensionUri, l10n.t("Library Properties"));
  }

  public body(): string {
    return `<div class="container">
      <h1>${l10n.t("Library: {libraryName}", { libraryName: this.libraryInfo.name })}</h1>

      <div class="section-title">${l10n.t("General Information")}</div>
      <table class="properties-table">
        <tr>
          <td class="property-label">${l10n.t("Name")}</td>
          <td>${this.escapeHtml(this.libraryInfo.name)}</td>
        </tr>
        <tr>
          <td class="property-label">${l10n.t("Engine")}</td>
          <td>${this.escapeHtml(this.libraryInfo.engine)}</td>
        </tr>
        <tr>
          <td class="property-label">${l10n.t("Read Only")}</td>
          <td>${this.libraryInfo.readOnly ? l10n.t("Yes") : l10n.t("No")}</td>
        </tr>
      </table>

      ${this.generatePathsContent()}
    </div>`;
  }

  public scripts(): string[] {
    return [];
  }

  public styles(): string[] {
    // Use the same CSS as TablePropertiesViewer
    return ["TablePropertiesViewer.css"];
  }

  public processMessage(): void {
    // No messages to process for this static viewer
  }

  private generatePathsContent(): string {
    if (this.libraryInfo.paths.length === 0) {
      return "";
    }

    const isConcatenated = this.libraryInfo.paths.length > 1;
    const title = isConcatenated
      ? l10n.t("Library Paths (Concatenated)")
      : l10n.t("Library Path");

    const pathsRows = this.libraryInfo.paths
      .map((path, index) => {
        const metadata = this.formatPathMetadata(path.infoProperties);
        const pathDisplay = metadata
          ? `${this.escapeHtml(path.physicalName)}<br/><small style="color: var(--vscode-descriptionForeground);">${metadata}</small>`
          : this.escapeHtml(path.physicalName);

        return `
          <tr>
            ${isConcatenated ? `<td>${index + 1}</td>` : ""}
            <td>${pathDisplay}</td>
            <td>${this.escapeHtml(path.engineName)}</td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="section-title">${title}</div>
      <table class="properties-table">
        <thead>
          <tr>
            ${isConcatenated ? `<th>${l10n.t("#")}</th>` : ""}
            <th>${l10n.t("Physical Path")}</th>
            <th>${l10n.t("Engine")}</th>
          </tr>
        </thead>
        <tbody>
          ${pathsRows}
        </tbody>
      </table>
    `;
  }

  private formatPathMetadata(infoProperties?: Record<string, string>): string {
    if (!infoProperties) {
      return "";
    }

    // Only show Owner Name and Access Permission, skip File Size and Inode
    const relevantKeys = ["Owner Name", "Access Permission"];
    const metadata: string[] = [];

    for (const key of relevantKeys) {
      const value = infoProperties[key];
      if (value && value.trim() !== "") {
        metadata.push(`${key}: ${value}`);
      }
    }

    return metadata.join(" | ");
  }

  private escapeHtml(text: string): string {
    if (!text) {
      return "";
    }
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

export default LibraryPropertiesViewer;
