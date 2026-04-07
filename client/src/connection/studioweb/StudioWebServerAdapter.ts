// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { FileType, Uri } from "vscode";

import {
  SAS_SERVER_ROOT_FOLDER,
  SAS_SERVER_ROOT_FOLDERS,
  SERVER_FOLDER_ID,
} from "../../components/ContentNavigator/const";
import {
  ContentAdapter,
  ContentItem,
  Link,
  RootFolderMap,
} from "../../components/ContentNavigator/types";
import {
  ContextMenuAction,
  ContextMenuProvider,
  convertStaticFolderToContentItem,
  createStaticFolder,
  homeDirectoryNameAndType,
  sortedContentItems,
} from "../../components/ContentNavigator/utils";
import { ProfileWithFileRootOptions } from "../../components/profile";
import { ensureCredentials } from "./index";
import { mapVscodeEncodingToSas } from "./encodingMap";
import { getAxios, getCredentials, getEncodeDoubleSlashes, getServerEncoding } from "./state";

/**
 * Encode a filesystem path using SAS Studio's tilde notation for directory listing.
 * `/` → `~ps~`, `.` → `~dot~` (no trailing tilde for directories).
 * Example: `/folders/myfolders` → `~ps~folders~ps~myfolders`
 */
function encodeDirectoryPath(dirPath: string): string {
  return dirPath.replace(/\./g, "~dot~").replace(/\//g, "~ps~");
}

/**
 * Encode a path for use in tree store REST body values (slash-only, no dot encoding).
 * The SAS Studio 3.8 tree store IDs use `~ps~` for `/` but keep `.` as-is.
 * Example: `/folders/myfolders/file.sas` → `~ps~folders~ps~myfolders~ps~file.sas`
 */
function encodeTreePath(path: string): string {
  return path.replace(/\//g, "~ps~");
}

/**
 * Build the workspace URL for a session file path. When the profile has
 * `encodeDoubleSlashes` enabled, any `//` in the path portion is replaced
 * with `/~~ds~~` so that production SAS Studio hosts that require this
 * encoding can resolve the request correctly.
 */
function workspaceUrl(sessionId: string, path: string): string {
  let url = `/sessions/${sessionId}/workspace/${path}`;
  if (getEncodeDoubleSlashes()) {
    const [pathPart, ...queryParts] = url.split("?");
    const encoded = pathPart.replace(/\/\//g, "/~~ds~~");
    url = queryParts.length > 0 ? `${encoded}?${queryParts.join("?")}` : encoded;
  }
  return url;
}

interface WorkspaceEntry {
  name: string;
  uri?: string;
  path?: string;
  type?: string; // "file" | "directory" | "dir"
  isDirectory?: boolean;
  category?: number; // 0 = directory, 1+ = file
  modifiedTimeStamp?: string | number;
  modifiedDate?: number; // Unix timestamp in milliseconds (from SAS Studio 3.8 API)
  creationTimeStamp?: string | number;
  size?: number | string; // Can be number or "166 bytes" string
  parentFolderUri?: string;
  uriParent?: string;
  haveChildren?: boolean;
}

class StudioWebServerAdapter implements ContentAdapter {
  private rootFolders: RootFolderMap;
  private contextMenuProvider: ContextMenuProvider;
  // Maps URI → ContentItem for each direct logical child of the root node.
  // Populated by getChildItems(SERVER_FOLDER_ID) and used by getParentOfItem
  // so that the parent chain returned to TreeView.reveal() uses items whose
  // uid exactly matches what getChildren() returns, rather than synthetic items
  // built from physical paths (which may not exist in the logical tree).
  private rootChildrenByUri = new Map<string, ContentItem>();

  public constructor(
    protected readonly fileNavigationCustomRootPath: ProfileWithFileRootOptions["fileNavigationCustomRootPath"],
    protected readonly fileNavigationRoot: ProfileWithFileRootOptions["fileNavigationRoot"],
  ) {
    this.rootFolders = {};
    this.contextMenuProvider = new ContextMenuProvider(
      [
        ContextMenuAction.CreateChild,
        ContextMenuAction.Delete,
        ContextMenuAction.Update,
        ContextMenuAction.CopyPath,
        ContextMenuAction.AllowDownload,
      ],
      {
        [ContextMenuAction.CopyPath]: (item) => item.id !== SERVER_FOLDER_ID,
      },
    );
  }

  /* Favorites / flow operations – not applicable to SAS Server */
  public async addChildItem(): Promise<boolean> {
    throw new Error("Method not implemented");
  }
  public async addItemToFavorites(): Promise<boolean> {
    throw new Error("Method not implemented");
  }
  public removeItemFromFavorites(): Promise<boolean> {
    throw new Error("Method not implemented");
  }
  public getRootFolder(): ContentItem | undefined {
    return undefined;
  }

  public async connect(): Promise<void> {
    // no-op: credentials are managed by StudioWebSession via state.ts
  }

  public connected(): boolean {
    return true;
  }

  public async getFolderPathForItem(): Promise<string> {
    return "";
  }

  public async getRootItems(): Promise<RootFolderMap> {
    for (let index = 0; index < SAS_SERVER_ROOT_FOLDERS.length; ++index) {
      const delegateFolderName = SAS_SERVER_ROOT_FOLDERS[index];
      this.rootFolders[delegateFolderName] = {
        ...convertStaticFolderToContentItem(SAS_SERVER_ROOT_FOLDER, {
          write: false,
          delete: false,
          addMember: false,
        }),
        uid: `${index}`,
      };
    }
    return this.rootFolders;
  }

  public async getChildItems(parentItem: ContentItem): Promise<ContentItem[]> {
    if (!(await ensureCredentials())) {
      return [];
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return [];
    }

    // Root folder: fetch the home/starting directory entry
    if (parentItem.id === SERVER_FOLDER_ID) {
      try {
        const rootUrl = `/${creds.sessionId}/_root_`;
        const response = await axios.get(rootUrl);
        const data = response.data;

        // Per SASStudio-FileOperations-API.md, _root_ returns:
        // { id: "_root_", name: "...", isDirectory: true, uri: "/", children: [...] }
        // The children array contains top-level items like "My Folders", "Folder Shortcuts"
        const children: WorkspaceEntry[] = Array.isArray(data?.children)
          ? data.children
          : [];

        if (children.length === 0) {
          // Fallback: create a home folder pointing to root
          const [homeName, homeType] = homeDirectoryNameAndType(
            this.fileNavigationRoot,
            this.fileNavigationCustomRootPath,
          );

          const homeFolder = convertStaticFolderToContentItem(
            createStaticFolder("/", homeName, homeType, "/", "getDirectoryMembers"),
            { write: false, delete: false, addMember: true },
          );
          homeFolder.contextValue =
            this.contextMenuProvider.availableActions(homeFolder);
          return [homeFolder];
        }

        // Convert each root child (e.g., "My Folders", "Folder Shortcuts") to a ContentItem
        const childItems = children
          .filter((e) => e.name)
          .map((entry) => {
            const isDir = entry.isDirectory === true;
            const uri = entry.uri ?? `/${entry.name}`;
            return this.convertEntryToContentItem(
              { ...entry, uri, isDirectory: isDir },
              "/",
            );
          });

        const sorted = sortedContentItems(childItems);
        // Cache so getParentOfItem can return the correct item (with matching uid)
        // when traversing up from a file inside one of these root children.
        this.rootChildrenByUri = new Map(sorted.map((i) => [i.uri, i]));
        return sorted;
      } catch (error) {
        console.error("StudioWebServerAdapter.getChildItems(_root_) error:", error);
        return [];
      }
    }

    // For normal folders, list their children via workspace API
    try {
      // Find the "getDirectoryMembers" link URI, which holds the directory path
      const dirLink = parentItem.links?.find(
        (l) => l.rel === "getDirectoryMembers",
      );
      const dirPath = dirLink?.uri ?? parentItem.uri;
      const dirUrl = `/${creds.sessionId}/${encodeDirectoryPath(dirPath)}`;

      const response = await axios.get(dirUrl);

      const data = response.data;
      // Per SASStudio-FileOperations-API.md, folder response includes a `children` array
      const entries: WorkspaceEntry[] = Array.isArray(data?.children)
        ? data.children
        : Array.isArray(data)
          ? data
          : data?.items
            ? data.items
            : [];

      const childItems = entries
        .filter((e) => e.name) // skip unnamed entries
        .map((entry) => {
          // The entry.uri from API is the full path; use it directly
          const uri = entry.uri ?? `${dirPath}/${entry.name}`;
          return this.convertEntryToContentItem({ ...entry, uri }, dirPath);
        });

      return sortedContentItems(childItems);
    } catch (error) {
      console.error(
        "[StudioWeb] getChildItems error for",
        parentItem.uri,
        error,
      );
      return [];
    }
  }

  private convertEntryToContentItem(
    entry: WorkspaceEntry,
    parentPath: string,
  ): ContentItem {
    const isDir =
      entry.isDirectory === true ||
      entry.category === 0 ||
      entry.type === "directory" ||
      entry.type === "dir";

    const fileType = isDir ? FileType.Directory : FileType.File;
    const name = entry.name ?? "";

    // Build the full path
    const uri =
      entry.uri ??
      entry.path ??
      (parentPath.endsWith("/")
        ? `${parentPath}${name}`
        : `${parentPath}/${name}`);

    // SAS Studio 3.8 uses modifiedDate (timestamp in ms), fallback to modifiedTimeStamp
    const modifiedTimeStamp =
      entry.modifiedDate ??
      (entry.modifiedTimeStamp
        ? typeof entry.modifiedTimeStamp === "number"
          ? entry.modifiedTimeStamp
          : new Date(String(entry.modifiedTimeStamp).replace(/[^0-9]/g, "")).getTime() || 0
        : 0);

    const creationTimeStamp = entry.creationTimeStamp
      ? typeof entry.creationTimeStamp === "number"
        ? entry.creationTimeStamp
        : new Date(String(entry.creationTimeStamp)).getTime() || 0
      : 0;

    const links = [
      isDir && {
        method: "GET",
        rel: "getDirectoryMembers",
        href: uri,
        uri: uri,
        type: "GET",
      },
      { method: "GET", rel: "self", href: uri, uri: uri, type: "GET" },
    ].filter((x): x is Link => !!x);

    const item: ContentItem = {
      id: uri,
      uid: uri,
      uri,
      name,
      creationTimeStamp,
      modifiedTimeStamp,
      links,
      parentFolderUri: entry.parentFolderUri || entry.uriParent || parentPath,
      permission: {
        write: true,
        delete: true,
        addMember: isDir,
      },
      type: "",
      fileStat: {
        ctime: 0,
        mtime: modifiedTimeStamp,
        size:
          typeof entry.size === "number"
            ? entry.size
            : typeof entry.size === "string"
              ? parseInt(entry.size, 10) || 0
              : 0,
        type: fileType,
      },
    };

    // Use the full server path as the URI path (not just the filename) so that
    // two files with the same name in different folders get distinct VS Code URIs
    // and can be opened simultaneously without conflicting in the editor.
    const vscUri = Uri.parse(
      `sasServer:${uri.replace(/#/g, "%23").replace(/\?/g, "%3F")}`,
    );

    return {
      ...item,
      contextValue: this.contextMenuProvider.availableActions(item),
      vscUri,
    };
  }

  public async getContentOfItem(item: ContentItem): Promise<string> {
    if (!(await ensureCredentials())) {
      return "";
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return "";
    }

    try {
      // SAS Studio 3.8 uses double-slash: GET /sasexec/sessions/{id}/workspace//{path}
      // Use arraybuffer so we get the raw bytes and can decode with the server's encoding.
      const response = await axios.get(
        workspaceUrl(creds.sessionId, item.uri),
        { responseType: "arraybuffer" },
      );
      return new TextDecoder(getServerEncoding()).decode(response.data);
    } catch (error) {
      console.error("StudioWebServerAdapter.getContentOfItem error:", error);
      return "";
    }
  }

  public async getContentOfItemRaw(item: ContentItem): Promise<Uint8Array> {
    if (!(await ensureCredentials())) {
      return new Uint8Array();
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return new Uint8Array();
    }

    try {
      const response = await axios.get(
        workspaceUrl(creds.sessionId, item.uri),
        { responseType: "arraybuffer" },
      );
      return new Uint8Array(response.data);
    } catch (error) {
      console.error("StudioWebServerAdapter.getContentOfItemRaw error:", error);
      return new Uint8Array();
    }
  }

  public async getContentOfUriRaw(uri: Uri): Promise<Uint8Array> {
    const path = uri.path;
    const item = await this.getItemAtPath(path);
    return await this.getContentOfItemRaw(item);
  }

  public async getContentOfUri(uri: Uri): Promise<string> {
    // vscUri for SAS Server files encodes the full server path as uri.path
    const path = uri.path;
    const item = await this.getItemAtPath(path);
    return (await this.getContentOfItem(item)) || "";
  }

  public async getItemOfUri(uri: Uri): Promise<ContentItem> {
    const path = uri.path;
    return this.getItemAtPath(path);
  }

  public async updateContentOfItem(
    uri: Uri,
    content: string,
    encoding?: string,
  ): Promise<void> {
    if (!(await ensureCredentials())) {
      return;
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return;
    }

    const path = uri.path;
    const sasEncoding = encoding
      ? mapVscodeEncodingToSas(encoding)
      : getServerEncoding();
    // The server expects UTF-8 body. When server encoding is not UTF-8,
    // the ?encoding param tells it to transcode UTF-8 → the target encoding.
    const encodingParam =
      sasEncoding.toUpperCase() === "UTF-8" ? {} : { encoding: sasEncoding };
    // Use double-slash pattern matching getContentOfItem (~~ds~~ returns 404)
    await axios.post(
      workspaceUrl(creds.sessionId, path),
      content,
      {
        params: encodingParam,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      },
    );
  }

  public async updateContentOfItemRaw(
    uri: Uri,
    content: Uint8Array,
  ): Promise<void> {
    if (!(await ensureCredentials())) {
      return;
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return;
    }

    const path = uri.path;
    try {
      await axios.post(workspaceUrl(creds.sessionId, path), Buffer.from(content), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    } catch (error) {
      console.error("StudioWebServerAdapter.updateContentOfItemRaw error:", error);
      throw error;
    }
  }

  public async deleteItem(item: ContentItem): Promise<boolean> {
    if (!(await ensureCredentials())) {
      return false;
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return false;
    }

    try {
      // Use double-slash pattern (~~ds~~ returns 404 on /sessions/ workspace endpoint)
      await axios.delete(
        workspaceUrl(creds.sessionId, item.uri),
      );
      return true;
    } catch (error) {
      console.error("StudioWebServerAdapter.deleteItem error:", error);
      return false;
    }
  }

  public async createNewItem(
    parentItem: ContentItem,
    fileName: string,
    buffer?: ArrayBufferLike,
  ): Promise<ContentItem | undefined> {
    if (!(await ensureCredentials())) {
      return undefined;
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return undefined;
    }

    try {
      const parentPath = parentItem.uri;
      const filePath = parentPath.endsWith("/")
        ? `${parentPath}${fileName}`
        : `${parentPath}/${fileName}`;

      // Prevent silently overwriting an existing file
      const existingChildren = await this.getChildItems(parentItem);
      if (existingChildren.some((child) => child.name === fileName)) {
        return undefined;
      }

      if (buffer) {
        // Send raw bytes as octet-stream to avoid TextDecoder corrupting binary
        // data (e.g. ZIP files) with UTF-8 replacement characters (U+FFFD).
        await axios.post(
          workspaceUrl(creds.sessionId, filePath),
          Buffer.from(buffer),
          {
            headers: { "Content-Type": "application/octet-stream" },
          },
        );
      } else {
        // Empty file creation: use text/plain with optional encoding param.
        const encoding = getServerEncoding();
        const encodingParam =
          encoding.toUpperCase() === "UTF-8" ? {} : { encoding };
        // Use double-slash pattern (~~ds~~ returns 404 on /sessions/ workspace endpoint)
        await axios.post(
          workspaceUrl(creds.sessionId, filePath),
          "",
          {
            params: encodingParam,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
          },
        );
      }

      return this.convertEntryToContentItem(
        { name: fileName, uri: filePath, isDirectory: false },
        parentPath,
      );
    } catch (error) {
      console.error("StudioWebServerAdapter.createNewItem error:", error);
      return undefined;
    }
  }

  public async createNewFolder(
    parentItem: ContentItem,
    folderName: string,
  ): Promise<ContentItem | undefined> {
    if (!(await ensureCredentials())) {
      return undefined;
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return undefined;
    }

    try {
      const parentPath = parentItem.uri;
      const folderPath = parentPath.endsWith("/")
        ? `${parentPath}${folderName}`
        : `${parentPath}/${folderName}`;
      const encodedParent = encodeDirectoryPath(parentPath);

      // Fetch current parent folder data (children list required by the tree store PUT)
      const parentData = (await axios.get(`/${creds.sessionId}/${encodedParent}`))
        .data;

      const parentUri = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
      const newFolder = {
        stub: false,
        asciiEbcdicConversionRequired: false,
        id: encodeTreePath(folderPath),
        name: folderName,
        isDirectory: true,
        uri: folderPath,
        uriParent: parentUri,
        children: [],
        haveChildren: false,
      };

      const updatedParent = {
        ...parentData,
        children: [...(parentData.children ?? []), newFolder],
      };

      // PUT the parent object with the new folder appended to its children
      await axios.put(`/${creds.sessionId}/${encodedParent}`, updatedParent);

      return this.convertEntryToContentItem(
        { name: folderName, uri: folderPath, isDirectory: true },
        parentPath,
      );
    } catch (error) {
      console.error("StudioWebServerAdapter.createNewFolder error:", error);
      return undefined;
    }
  }

  public async renameItem(
    item: ContentItem,
    newName: string,
  ): Promise<ContentItem | undefined> {
    if (!(await ensureCredentials())) {
      return undefined;
    }

    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return undefined;
    }

    try {
      // Check for duplicate name in parent folder before renaming
      const parentUri =
        item.parentFolderUri ??
        item.uri.substring(0, item.uri.lastIndexOf("/"));
      const fakeParentItem = this.convertEntryToContentItem(
        { name: "", uri: parentUri, isDirectory: true },
        parentUri,
      );
      const existingChildren = await this.getChildItems(fakeParentItem);
      if (existingChildren.some((child) => child.name === newName)) {
        return undefined;
      }

      await axios.post(`/${creds.sessionId}/`, {
        operationName: "rename",
        newName,
        oldName: item.name,
        parent: encodeTreePath(item.uri),
        isPDSMember: false,
        isNativeMVS: false,
      });

      const newUri = parentUri.endsWith("/")
        ? `${parentUri}${newName}`
        : `${parentUri}/${newName}`;
      const isDir = item.fileStat?.type === FileType.Directory;

      return this.convertEntryToContentItem(
        { name: newName, uri: newUri, isDirectory: isDir },
        parentUri,
      );
    } catch (error) {
      console.error("StudioWebServerAdapter.renameItem error:", error);
      return undefined;
    }
  }

  public async moveItem(
    item: ContentItem,
    targetParentFolderUri: string,
  ): Promise<Uri | undefined> {
    if (!(await ensureCredentials())) {
      return undefined;
    }
    const axios = getAxios();
    const creds = getCredentials();
    if (!axios || !creds) {
      return undefined;
    }

    try {
      const isDir = item.fileStat?.type === FileType.Directory;
      const oldParentUri =
        item.parentFolderUri ??
        item.uri.substring(0, item.uri.lastIndexOf("/"));

      await axios.post(`/${creds.sessionId}/`, {
        operationName: "move",
        child: item.name,
        childURI: item.uri,
        oldParent: encodeTreePath(oldParentUri),
        newParent: encodeTreePath(targetParentFolderUri),
        isNewParentPDS: "false",
        isCopy: "false",
        isDirectory: String(isDir),
        isPDSMember: "false",
        asciiEbcdicConversionRequired: false,
      });

      const newUri = targetParentFolderUri.endsWith("/")
        ? `${targetParentFolderUri}${item.name}`
        : `${targetParentFolderUri}/${item.name}`;
      return Uri.parse(`sasServer:${newUri}`);
    } catch (error) {
      console.error("StudioWebServerAdapter.moveItem error:", error);
      return undefined;
    }
  }

  public async getParentOfItem(
    item: ContentItem,
  ): Promise<ContentItem | undefined> {
    const rootNode = this.rootFolders[SAS_SERVER_ROOT_FOLDERS[0]];

    // If item itself is a direct logical child of the root (e.g. /folders/myfolders),
    // its physical parent path (e.g. /folders) does not exist as a tree node.
    // Check this BEFORE the parentFolderUri guard because parentFolderUri may be
    // empty (""), physically wrong, or missing for root children.
    if (this.rootChildrenByUri.has(item.uri)) {
      return rootNode;
    }

    if (!item.parentFolderUri) {
      return undefined;
    }

    // Items whose parent is the filesystem root ("/") are direct children of
    // the virtual "SAS Server" root node. Check this BEFORE normalizing so
    // that "/" is not converted to "" by the trailing-slash strip below.
    if (item.parentFolderUri === "/" || item.parentFolderUri === SERVER_FOLDER_ID) {
      return rootNode;
    }

    // Normalize: strip trailing slash from parentFolderUri. Items loaded via
    // syntheticFolder navigation in QuickBrowser may have parentFolderUri with
    // a trailing slash (e.g. "/home/sasdemo/") while rootChildrenByUri keys
    // are stored without trailing slashes (e.g. "/home/sasdemo").
    const parentUri = item.parentFolderUri.replace(/\/$/, "");

    // Lazy-load root children if the cache is empty. This happens when
    // QuickBrowser is used to navigate to an absolute path before the user
    // has expanded the SAS Server tree, so rootChildrenByUri has never been
    // populated. Loading it here ensures the parent chain is resolved correctly.
    if (this.rootChildrenByUri.size === 0) {
      try {
        await this.getChildItems(rootNode);
      } catch {
        // ignore; proceed with potentially incomplete cache
      }
    }

    // Re-check after lazy-loading in case item itself is now found as a root child.
    if (this.rootChildrenByUri.has(item.uri)) {
      return rootNode;
    }

    // If item's physical parent is a direct logical root child, return the
    // cached ContentItem so its uid exactly matches what getChildren returns.
    const cachedParent = this.rootChildrenByUri.get(parentUri);
    if (cachedParent) {
      return cachedParent;
    }

    try {
      return await this.getItemAtPath(parentUri, true);
    } catch {
      return undefined;
    }
  }

  public async getPathOfItem(item: ContentItem): Promise<string> {
    return item.uri;
  }

  public async getUriOfItem(item: ContentItem): Promise<Uri> {
    return item.vscUri;
  }

  /** Retrieve a ContentItem for a given filesystem path. */
  private async getItemAtPath(
    path: string,
    isDirectory = false,
  ): Promise<ContentItem> {
    // Derive parent path and name from the path
    const normalised = path.replace(/\/$/, "");
    const lastSlash = normalised.lastIndexOf("/");
    const name = lastSlash >= 0 ? normalised.slice(lastSlash + 1) : normalised;
    const parentPath = lastSlash > 0 ? normalised.slice(0, lastSlash) : "/";

    return this.convertEntryToContentItem(
      { name, uri: normalised, isDirectory },
      parentPath,
    );
  }
}

export default StudioWebServerAdapter;
