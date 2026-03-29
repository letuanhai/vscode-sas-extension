// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  deriveParentPath,
  isFolder,
  sortContentItems,
  syntheticFolder,
} from "../../src/components/ContentNavigator/QuickFileBrowser";
import { ContentItem, Link } from "../../src/components/ContentNavigator/types";

// ---------------------------------------------------------------------------
// Helper: build a minimal ContentItem for tests
// ---------------------------------------------------------------------------
function makeItem(
  name: string,
  type?: "folder" | "file",
  extraLinks?: Link[],
): ContentItem {
  return {
    id: name,
    uri: `/path/${name}`,
    name,
    links: [
      ...(type === "folder"
        ? [
            {
              method: "GET",
              rel: "getDirectoryMembers",
              href: `/path/${name}`,
              uri: `/path/${name}`,
              type: "GET",
            },
          ]
        : []),
      ...(extraLinks ?? []),
    ],
    permission: { write: false, delete: false, addMember: false },
    creationTimeStamp: 0,
    modifiedTimeStamp: 0,
    ...(type ? { type } : {}),
  };
}

// ---------------------------------------------------------------------------
// syntheticFolder
// ---------------------------------------------------------------------------
describe("syntheticFolder", () => {
  it("produces correct id for a standard path", () => {
    const item = syntheticFolder("/home/sasdemo");
    expect(item.id).to.equal("synthetic:/home/sasdemo");
  });

  it("produces correct uri for a standard path", () => {
    const item = syntheticFolder("/home/sasdemo");
    expect(item.uri).to.equal("/home/sasdemo");
  });

  it("uses the last path segment as name", () => {
    const item = syntheticFolder("/home/sasdemo");
    expect(item.name).to.equal("sasdemo");
  });

  it("has exactly one link with rel getDirectoryMembers pointing to the path", () => {
    const item = syntheticFolder("/home/sasdemo");
    expect(item.links).to.have.lengthOf(1);
    const link = item.links[0];
    expect(link.rel).to.equal("getDirectoryMembers");
    expect(link.uri).to.equal("/home/sasdemo");
  });

  it("has permission with all flags false", () => {
    const item = syntheticFolder("/home/sasdemo");
    expect(item.permission).to.deep.equal({
      write: false,
      delete: false,
      addMember: false,
    });
  });

  it("has creationTimeStamp and modifiedTimeStamp of 0", () => {
    const item = syntheticFolder("/home/sasdemo");
    expect(item.creationTimeStamp).to.equal(0);
    expect(item.modifiedTimeStamp).to.equal(0);
  });

  it("uses '/' as name when path is root '/'", () => {
    const item = syntheticFolder("/");
    expect(item.name).to.equal("/");
  });

  it("uses the last segment for a deeply nested path", () => {
    const item = syntheticFolder("/deep/nested/path");
    expect(item.name).to.equal("path");
  });
});

// ---------------------------------------------------------------------------
// isFolder
// ---------------------------------------------------------------------------
describe("isFolder", () => {
  it("returns true for an item with a getDirectoryMembers link", () => {
    const item = makeItem("mydir", "folder");
    expect(isFolder(item)).to.be.true;
  });

  it("returns true for an item with type === 'folder' even without the link", () => {
    const item: ContentItem = {
      id: "typedFolder",
      uri: "/path/typedFolder",
      name: "typedFolder",
      links: [],
      type: "folder",
      permission: { write: false, delete: false, addMember: false },
      creationTimeStamp: 0,
      modifiedTimeStamp: 0,
    };
    expect(isFolder(item)).to.be.true;
  });

  it("returns false for an item with no links and no type", () => {
    const item = makeItem("plainfile");
    expect(isFolder(item)).to.be.false;
  });

  it("returns false for an item with only a non-folder link rel (e.g. 'self') and no type", () => {
    const selfLink: Link = {
      method: "GET",
      rel: "self",
      href: "/path/afile",
      uri: "/path/afile",
      type: "GET",
    };
    const item = makeItem("afile", undefined, [selfLink]);
    expect(isFolder(item)).to.be.false;
  });
});

// ---------------------------------------------------------------------------
// sortContentItems
// ---------------------------------------------------------------------------
describe("sortContentItems", () => {
  it("places folders before files", () => {
    const items = [
      makeItem("readme.txt", "file"),
      makeItem("docs", "folder"),
    ];
    const sorted = sortContentItems(items);
    expect(sorted[0].name).to.equal("docs");
    expect(sorted[1].name).to.equal("readme.txt");
  });

  it("sorts folders alphabetically (case-insensitive)", () => {
    const items = [
      makeItem("Zoo", "folder"),
      makeItem("alpha", "folder"),
      makeItem("Beta", "folder"),
    ];
    const sorted = sortContentItems(items);
    expect(sorted.map((i) => i.name.toLowerCase())).to.deep.equal([
      "alpha",
      "beta",
      "zoo",
    ]);
  });

  it("sorts files alphabetically (case-insensitive)", () => {
    const items = [
      makeItem("zebra.sas", "file"),
      makeItem("Apple.sas", "file"),
      makeItem("mango.sas", "file"),
    ];
    const sorted = sortContentItems(items);
    expect(sorted.map((i) => i.name.toLowerCase())).to.deep.equal([
      "apple.sas",
      "mango.sas",
      "zebra.sas",
    ]);
  });

  it("correctly sorts a mixed array of folders and files", () => {
    const items = [
      makeItem("zfile.sas", "file"),
      makeItem("aFolder", "folder"),
      makeItem("afile.sas", "file"),
      makeItem("zFolder", "folder"),
    ];
    const sorted = sortContentItems(items);
    // Folders first, then files; each group alphabetical
    expect(sorted[0].name.toLowerCase()).to.equal("afolder");
    expect(sorted[1].name.toLowerCase()).to.equal("zfolder");
    expect(sorted[2].name.toLowerCase()).to.equal("afile.sas");
    expect(sorted[3].name.toLowerCase()).to.equal("zfile.sas");
  });

  it("returns an empty array when given an empty array", () => {
    expect(sortContentItems([])).to.deep.equal([]);
  });

  it("returns a single item unchanged", () => {
    const item = makeItem("solo.sas", "file");
    const sorted = sortContentItems([item]);
    expect(sorted).to.have.lengthOf(1);
    expect(sorted[0].name).to.equal("solo.sas");
  });
});

// ---------------------------------------------------------------------------
// deriveParentPath
// ---------------------------------------------------------------------------
describe("deriveParentPath", () => {
  it('returns "/home" for "/home/sasdemo"', () => {
    expect(deriveParentPath("/home/sasdemo")).to.equal("/home");
  });

  it('returns undefined for "/home" (root-level path, lastSlash === 0)', () => {
    expect(deriveParentPath("/home")).to.be.undefined;
  });

  it('returns undefined for "/" (already root)', () => {
    expect(deriveParentPath("/")).to.be.undefined;
  });

  it('returns "/a/b" for "/a/b/c"', () => {
    expect(deriveParentPath("/a/b/c")).to.equal("/a/b");
  });

  it('strips trailing slash and returns "/a/b" for "/a/b/c/"', () => {
    expect(deriveParentPath("/a/b/c/")).to.equal("/a/b");
  });

  it('returns "/home/sasdemo" for "/home/sasdemo/projects"', () => {
    expect(deriveParentPath("/home/sasdemo/projects")).to.equal("/home/sasdemo");
  });
});
