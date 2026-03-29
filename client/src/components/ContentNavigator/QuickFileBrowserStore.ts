// Copyright © 2023, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Memento } from "vscode";

export interface StoredItem {
  uri: string; // server-side path (e.g. /home/sasdemo/file.sas)
  name: string; // display name
  isFolder: boolean;
  vsUri?: string; // vscode URI string — only for files, so history can reopen without a fresh getUri() call
}

const HISTORY_KEY = "quickFileBrowser.history";
const BOOKMARKS_KEY = "quickFileBrowser.bookmarks";
const MAX_HISTORY = 20;

export class QuickFileBrowserStore {
  constructor(private readonly memento: Memento) {}

  getHistory(): StoredItem[] {
    return this.memento.get<StoredItem[]>(HISTORY_KEY, []);
  }

  pushHistory(
    item: { uri: string; name: string },
    isFolder: boolean,
    vsUri?: string,
  ): void {
    const list = this.getHistory().filter((h) => h.uri !== item.uri);
    list.unshift({ uri: item.uri, name: item.name, isFolder, vsUri });
    void this.memento.update(HISTORY_KEY, list.slice(0, MAX_HISTORY));
  }

  removeHistory(uri: string): void {
    void this.memento.update(
      HISTORY_KEY,
      this.getHistory().filter((h) => h.uri !== uri),
    );
  }

  getBookmarks(): StoredItem[] {
    return this.memento.get<StoredItem[]>(BOOKMARKS_KEY, []);
  }

  isBookmarked(uri: string): boolean {
    return this.getBookmarks().some((b) => b.uri === uri);
  }

  addBookmark(
    item: { uri: string; name: string },
    isFolder: boolean,
    vsUri?: string,
  ): void {
    if (!this.isBookmarked(item.uri)) {
      void this.memento.update(BOOKMARKS_KEY, [
        ...this.getBookmarks(),
        { uri: item.uri, name: item.name, isFolder, vsUri },
      ]);
    }
  }

  removeBookmark(uri: string): void {
    void this.memento.update(
      BOOKMARKS_KEY,
      this.getBookmarks().filter((b) => b.uri !== uri),
    );
  }

  toggleBookmark(
    item: { uri: string; name: string },
    isFolder: boolean,
    vsUri?: string,
  ): void {
    if (this.isBookmarked(item.uri)) {
      this.removeBookmark(item.uri);
    } else {
      this.addBookmark(item, isFolder, vsUri);
    }
  }

  clearHistory(): void {
    void this.memento.update(HISTORY_KEY, []);
  }
}
