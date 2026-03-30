// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  ConfigurationChangeEvent,
  Disposable,
  ExtensionContext,
  Uri,
  commands,
  env,
  l10n,
  window,
  workspace,
} from "vscode";

import { createWriteStream } from "fs";
import * as path from "path";

import { profileConfig } from "../../commands/profile";
import { Column } from "../../connection/rest/api/compute";
import DataViewer, { ViewProperties } from "../../panels/DataViewer";
import TablePropertiesViewer from "../../panels/TablePropertiesViewer";
import { WebViewManager } from "../../panels/WebviewManager";
import { SubscriptionProvider } from "../SubscriptionProvider";
import { treeViewSelections } from "../utils/treeViewSelections";
import LibraryAdapterFactory from "./LibraryAdapterFactory";
import LibraryDataProvider from "./LibraryDataProvider";
import LibraryModel from "./LibraryModel";
import PaginatedResultSet from "./PaginatedResultSet";
import { Messages } from "./const";
import { LibraryAdapter, LibraryItem, TableData } from "./types";

class LibraryNavigator implements SubscriptionProvider {
  private libraryDataProvider: LibraryDataProvider;
  private model: LibraryModel;
  private extensionUri: Uri;
  private webviewManager: WebViewManager;
  private lastActiveDataViewerUid: string | undefined;
  private openTables = new Map<
    string,
    {
      item: LibraryItem;
      fetchColumns: () => Column[];
      fetchRowCount: () => Promise<{ rowCount: number; columnCount?: number }>;
    }
  >();

  constructor(context: ExtensionContext) {
    this.extensionUri = context.extensionUri;
    this.model = new LibraryModel(this.libraryAdapterForConnectionType());
    this.libraryDataProvider = new LibraryDataProvider(
      this.model,
      context.extensionUri,
    );
    this.webviewManager = new WebViewManager();
  }

  public getSubscriptions(): Disposable[] {
    return [
      ...this.libraryDataProvider.getSubscriptions(),
      commands.registerCommand(
        "SAS.viewTable",
        async (
          item: LibraryItem,
          paginator: PaginatedResultSet<{ data: TableData; error?: Error }>,
          fetchColumns: () => Column[],
          fetchRowCount: () => Promise<{ rowCount: number; columnCount?: number }>,
        ) => {
          const existing = this.webviewManager.panels[item.uid] as
            | DataViewer
            | undefined;
          const viewer = this.makeDataViewer(
            item,
            paginator,
            fetchColumns,
            fetchRowCount,
            existing?.viewProperties,
          );
          this.openTables.set(item.uid, { item, fetchColumns, fetchRowCount });
          this.webviewManager.render(viewer, item.uid, !!existing);
        },
      ),
      commands.registerCommand("SAS.refreshLibraries", () => this.refresh()),
      commands.registerCommand("SAS.reloadActiveDataViewer", () =>
        this.reloadActiveDataViewer(),
      ),
      commands.registerCommand("SAS.reloadAllDataViewers", () =>
        this.reloadAllDataViewers(),
      ),
      commands.registerCommand("SAS.deleteTable", async (item: LibraryItem) => {
        const selectedItems = treeViewSelections(
          this.libraryDataProvider.treeView,
          item,
        );

        if (selectedItems.length === 0) {
          return;
        }

        const result = await window.showWarningMessage(
          l10n.t(Messages.TablesDeletionWarning),
          { modal: true },
          "Delete",
        );

        if (result !== "Delete") {
          return;
        }

        try {
          await this.libraryDataProvider.deleteTables(selectedItems);
        } catch (error) {
          window.showErrorMessage(error.message);
        }
      }),
      commands.registerCommand(
        "SAS.downloadTable",
        async (item: LibraryItem) => {
          let dataFilePath: string = "";
          if (
            env.remoteName !== undefined &&
            workspace.workspaceFolders &&
            workspace.workspaceFolders.length > 0
          ) {
            // start from 'rootPath' workspace folder
            dataFilePath = workspace.workspaceFolders[0].uri.fsPath;
          }
          dataFilePath = path.join(
            dataFilePath,
            `${item.library}.${item.name}.csv`.toLocaleLowerCase(),
          );

          // display save file dialog
          const uri = await window.showSaveDialog({
            defaultUri: Uri.file(dataFilePath),
          });

          if (!uri) {
            return;
          }

          const stream = createWriteStream(uri.fsPath);
          await this.libraryDataProvider.writeTableContentsToStream(
            stream,
            item,
          );
        },
      ),
      commands.registerCommand(
        "SAS.showTableProperties",
        async (item: LibraryItem) => {
          await this.displayTableProperties(item);
        },
      ),
      commands.registerCommand("SAS.collapseAllLibraries", () => {
        commands.executeCommand(
          "workbench.actions.treeView.librarydataprovider.collapseAll",
        );
      }),
      workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
        if (event.affectsConfiguration("SAS.connectionProfiles")) {
          this.refresh();
        }
      }),
    ];
  }

  public async refresh(): Promise<void> {
    this.libraryDataProvider.useAdapter(this.libraryAdapterForConnectionType());
  }

  private reloadActiveDataViewer(): void {
    // Try the panel VS Code currently considers active
    for (const [uid, entry] of this.openTables) {
      const panel = this.webviewManager.panels[uid] as DataViewer | undefined;
      if (panel?.getPanel().active) {
        this.reloadDataViewer(uid, entry);
        return;
      }
    }
    // Fall back to the most recently active DataViewer (e.g. command palette was open)
    if (this.lastActiveDataViewerUid) {
      const entry = this.openTables.get(this.lastActiveDataViewerUid);
      if (entry && this.webviewManager.panels[this.lastActiveDataViewerUid]) {
        this.reloadDataViewer(this.lastActiveDataViewerUid, entry);
      }
    }
  }

  private reloadAllDataViewers(): void {
    for (const [uid, entry] of this.openTables) {
      if (this.webviewManager.panels[uid]) {
        this.reloadDataViewer(uid, entry);
      }
    }
  }

  private reloadDataViewer(
    uid: string,
    entry: {
      item: LibraryItem;
      fetchColumns: () => Column[];
      fetchRowCount: () => Promise<{ rowCount: number; columnCount?: number }>;
    },
  ): void {
    const existing = this.webviewManager.panels[uid] as DataViewer | undefined;
    if (!existing) {
      this.openTables.delete(uid);
      return;
    }
    const { item, fetchColumns, fetchRowCount } = entry;
    const viewer = this.makeDataViewer(
      item,
      this.model.getTableResultSet(item),
      fetchColumns,
      fetchRowCount,
      existing.viewProperties,
    );
    this.webviewManager.render(viewer, uid, true);
  }

  private makeDataViewer(
    item: LibraryItem,
    paginator: PaginatedResultSet<{ data: TableData; error?: Error }>,
    fetchColumns: () => Column[],
    fetchRowCount: () => Promise<{ rowCount: number; columnCount?: number }>,
    viewProperties?: ViewProperties,
  ): DataViewer {
    const viewer = new DataViewer(
      this.extensionUri,
      item.uid,
      paginator,
      fetchColumns,
      (columnName: string) => {
        this.displayTableProperties(item, true, columnName);
      },
      fetchRowCount,
    );
    if (viewProperties) {
      viewer.viewProperties = viewProperties;
    }
    viewer.onBecameActive = () => {
      this.lastActiveDataViewerUid = item.uid;
    };
    return viewer;
  }

  private async displayTableProperties(
    item: LibraryItem,
    showPropertiesTab: boolean = false,
    focusedColumn?: string,
  ) {
    try {
      const tableInfo = await this.libraryDataProvider.getTableInfo(item);
      const columns = await this.libraryDataProvider.fetchColumns(item);

      this.webviewManager.render(
        new TablePropertiesViewer(
          this.extensionUri,
          item.uid,
          tableInfo,
          columns,
          showPropertiesTab,
          focusedColumn,
        ),
        `properties-${item.uid}`,
        true,
      );
    } catch (error) {
      window.showErrorMessage(
        `Failed to load table properties: ${error.message}`,
      );
    }
  }

  private libraryAdapterForConnectionType(): LibraryAdapter | undefined {
    const activeProfile = profileConfig.getProfileByName(
      profileConfig.getActiveProfile(),
    );

    if (!activeProfile) {
      return;
    }

    return new LibraryAdapterFactory().create(activeProfile.connectionType);
  }
}

export default LibraryNavigator;
