// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Maps VS Code encoding names to SAS server encoding names.
 * VS Code uses names like 'iso88591', SAS expects 'ISO-8859-1'.
 */
const VSCODE_TO_SAS_ENCODING: Record<string, string> = {
  utf8: "UTF-8",
  utf8bom: "UTF-8",
  utf16le: "UTF-16LE",
  utf16be: "UTF-16BE",
  windows1252: "WINDOWS-1252",
  iso88591: "ISO-8859-1",
  iso88592: "ISO-8859-2",
  iso88593: "ISO-8859-3",
  iso88594: "ISO-8859-4",
  iso88595: "ISO-8859-5",
  iso88596: "ISO-8859-6",
  iso88597: "ISO-8859-7",
  iso88598: "ISO-8859-8",
  iso88599: "ISO-8859-9",
  iso885910: "ISO-8859-10",
  iso885911: "ISO-8859-11",
  iso885913: "ISO-8859-13",
  iso885914: "ISO-8859-14",
  iso885915: "ISO-8859-15",
  iso885916: "ISO-8859-16",
  windows1250: "WINDOWS-1250",
  windows1251: "WINDOWS-1251",
  windows1253: "WINDOWS-1253",
  windows1254: "WINDOWS-1254",
  windows1255: "WINDOWS-1255",
  windows1256: "WINDOWS-1256",
  windows1257: "WINDOWS-1257",
  windows1258: "WINDOWS-1258",
  macroman: "MACROMAN",
  cp437: "CP437",
  cp850: "CP850",
  cp852: "CP852",
  cp865: "CP865",
  cp866: "CP866",
  cp950: "CP950",
  cp1125: "CP1125",
  gbk: "GBK",
  gb18030: "GB18030",
  gb2312: "GB2312",
  big5hkscs: "BIG5-HKSCS",
  shiftjis: "SHIFT_JIS",
  eucjp: "EUC-JP",
  euckr: "EUC-KR",
  koi8r: "KOI8-R",
  koi8u: "KOI8-U",
  koi8ru: "KOI8-RU",
  koi8t: "KOI8-T",
  windows874: "WINDOWS-874",
};

export function mapVscodeEncodingToSas(vscodeEncoding: string): string {
  return VSCODE_TO_SAS_ENCODING[vscodeEncoding] || vscodeEncoding.toUpperCase();
}
