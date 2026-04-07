// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tests for ContentModel.downloadFile() — verifies that raw binary data is
// preserved when the adapter exposes getContentOfItemRaw(), and falls back to
// the string path otherwise.
import { Uri } from "vscode";

import { expect } from "chai";

import { ContentModel } from "../../src/components/ContentNavigator/ContentModel";
import { ContentAdapter, ContentItem } from "../../src/components/ContentNavigator/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeItem = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  id: "/folders/myfolders/test/archive.zip",
  uid: "/folders/myfolders/test/archive.zip",
  uri: "/folders/myfolders/test/archive.zip",
  name: "archive.zip",
  creationTimeStamp: 0,
  modifiedTimeStamp: 0,
  links: [],
  parentFolderUri: "/folders/myfolders/test",
  permission: { write: true, delete: true, addMember: false },
  ...overrides,
});

/** Minimal stub that satisfies the ContentAdapter interface */
function makeStubAdapter(overrides: Partial<ContentAdapter> = {}): ContentAdapter {
  return {
    addChildItem: async () => false,
    addItemToFavorites: async () => false,
    connect: async () => undefined,
    connected: () => true,
    createNewFolder: async () => undefined,
    createNewItem: async () => undefined,
    deleteItem: async () => false,
    getChildItems: async () => [],
    getContentOfItem: async () => "",
    getContentOfUri: async () => "",
    getFolderPathForItem: async () => "",
    getItemOfUri: async () => makeItem(),
    getParentOfItem: async () => undefined,
    getRootFolder: () => undefined,
    getRootItems: async () => ({}),
    getUriOfItem: async () => Uri.parse("sasServer:/test"),
    moveItem: async () => undefined,
    removeItemFromFavorites: async () => false,
    renameItem: async () => undefined,
    updateContentOfItem: async () => undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContentModel.downloadFile()", () => {
  // -------------------------------------------------------------------------
  // Test 1: uses getContentOfItemRaw when available, preserves binary data
  // -------------------------------------------------------------------------
  it("uses getContentOfItemRaw when available and preserves binary data exactly", async () => {
    // ZIP magic bytes + high bytes that TextDecoder would mangle
    const rawBytes = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // ZIP magic bytes (PK\x03\x04)
      0x80, 0xff, 0xfe, 0x00, // high bytes that UTF-8 decode corrupts
      0x01, 0x02, 0x03, 0x04,
    ]);

    const adapter = makeStubAdapter({
      getContentOfItemRaw: async () => rawBytes,
      // getContentOfItem should NOT be called when raw is available
      getContentOfItem: async () => {
        throw new Error("getContentOfItem should not be called");
      },
    });

    const model = new ContentModel(adapter);
    const result = await model.downloadFile(makeItem());

    expect(result).to.not.be.undefined;
    expect(result!.length).to.equal(rawBytes.length);

    // Verify every byte is preserved exactly
    for (let i = 0; i < rawBytes.length; i++) {
      expect(result![i]).to.equal(
        rawBytes[i],
        `byte at index ${i} should be 0x${rawBytes[i].toString(16).padStart(2, "0")}`,
      );
    }

    // Verify ZIP magic bytes specifically
    expect(result![0]).to.equal(0x50); // 'P'
    expect(result![1]).to.equal(0x4b); // 'K'
    expect(result![2]).to.equal(0x03);
    expect(result![3]).to.equal(0x04);

    // Verify high bytes are not corrupted
    expect(result![4]).to.equal(0x80);
    expect(result![5]).to.equal(0xff);
  });

  // -------------------------------------------------------------------------
  // Test 2: falls back to string path when getContentOfItemRaw is not available
  // -------------------------------------------------------------------------
  it("falls back to string path when getContentOfItemRaw is not defined", async () => {
    const textContent = "proc print data=sashelp.class; run;";

    const adapter = makeStubAdapter({
      // No getContentOfItemRaw property — adapter does not implement it
      getContentOfItem: async () => textContent,
    });
    // Ensure no raw method exists
    delete (adapter as Partial<ContentAdapter>).getContentOfItemRaw;

    const model = new ContentModel(adapter);
    const result = await model.downloadFile(makeItem());

    expect(result).to.not.be.undefined;
    // Buffer.from(str, "binary") should round-trip ASCII text correctly
    expect(result!.toString("binary")).to.equal(textContent);
  });

  // -------------------------------------------------------------------------
  // Test 3: documents the original bug — UTF-8 decode corrupts high bytes
  // -------------------------------------------------------------------------
  it("demonstrates that UTF-8 decode corrupts high bytes (original bug)", () => {
    // Simulate what the old code path did: TextDecoder over binary data
    const rawBytes = new Uint8Array([0x80, 0xff, 0x50, 0x4b]);

    // The old approach: decode as UTF-8 (corrupts high bytes → replacement chars)
    const decodedAsUtf8 = new TextDecoder("utf-8").decode(rawBytes);
    const corruptedBuffer = Buffer.from(decodedAsUtf8, "binary");

    // The fix: use raw bytes directly
    const correctBuffer = Buffer.from(rawBytes);

    // The two paths produce DIFFERENT results for high bytes
    expect(corruptedBuffer.equals(correctBuffer)).to.equal(
      false,
      "UTF-8 decode should corrupt high bytes, proving the bug exists",
    );

    // The correct buffer preserves originals
    expect(correctBuffer[0]).to.equal(0x80);
    expect(correctBuffer[1]).to.equal(0xff);

    // The corrupted buffer has replacement character sequences for invalid UTF-8
    // (0x80 and 0xFF are not valid UTF-8, so they become U+FFFD replacement chars)
    expect(corruptedBuffer[0]).to.not.equal(
      0x80,
      "0x80 should be corrupted by UTF-8 decode",
    );
  });
});
