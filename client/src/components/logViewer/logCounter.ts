// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { LogLine } from "../../connection";

export interface LogCounts {
  errorCount: number;
  warningCount: number;
}

export class LogCounter {
  errorCount = 0;
  warningCount = 0;

  count(logLine: LogLine): void {
    if (logLine.type === "error") {
      this.errorCount++;
    } else if (logLine.type === "warning") {
      this.warningCount++;
    } else if (logLine.line) {
      // For connection types that do not classify log lines (e.g., SSH, StudioWeb),
      // fall back to pattern matching on the line text.
      const match = logLine.line.match(/^\s*(ERROR|WARNING).*:.*$/i);
      if (match) {
        if (match[1].toLowerCase() === "error") {
          this.errorCount++;
        } else {
          this.warningCount++;
        }
      }
    }
  }

  reset(): void {
    this.errorCount = 0;
    this.warningCount = 0;
  }

  getCounts(): LogCounts {
    return { errorCount: this.errorCount, warningCount: this.warningCount };
  }
}
