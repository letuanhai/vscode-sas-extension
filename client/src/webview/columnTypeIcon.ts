// Copyright © 2025, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import localize from "./localize";

export const getIconForColumnType = (type: string) => {
  switch (type?.toLocaleLowerCase()) {
    case "float":
    case "num":
      return "float";
    case "date":
      return "date";
    case "time":
      return "time";
    case "datetime":
      return "date-time";
    case "currency":
      return "currency";
    case "char":
      return "char";
    default:
      return "";
  }
};

export const getTermForColumnType = (type: string) => {
  switch (type?.toLocaleLowerCase()) {
    case "float":
    case "num":
      return localize("Numeric");
    case "date":
      return localize("Date");
    case "time":
    case "datetime":
      return localize("Datetime");
    case "currency":
      return localize("Currency");
    case "char":
    default:
      return localize("Character");
  }
};
