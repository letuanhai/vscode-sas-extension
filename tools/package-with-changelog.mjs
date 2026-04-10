#!/usr/bin/env node
/**
 * Packaging script that combines CHANGELOG-SASSTUDIO-WEB.md with CHANGELOG.md
 * for the vsce package command, while keeping the worktree CHANGELOG.md unchanged.
 *
 * This allows us to maintain a clean upstream CHANGELOG.md for conflict-free
 * rebasing, while still including fork-specific changelog entries in the
 * packaged extension.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const CHANGELOG_PATH = path.join(rootDir, "CHANGELOG.md");
const FORK_CHANGELOG_PATH = path.join(rootDir, "CHANGELOG-SASSTUDIO-WEB.md");
const BACKUP_PATH = path.join(rootDir, "CHANGELOG.md.backup");

function main() {
  const args = process.argv.slice(2);
  const vsceArgs = args.join(" ");

  // Check if fork changelog exists
  if (!fs.existsSync(FORK_CHANGELOG_PATH)) {
    console.error(`Error: ${FORK_CHANGELOG_PATH} not found`);
    process.exit(1);
  }

  // Check if main changelog exists
  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error(`Error: ${CHANGELOG_PATH} not found`);
    process.exit(1);
  }

  let backupCreated = false;

  try {
    // Read the contents
    const forkContent = fs.readFileSync(FORK_CHANGELOG_PATH, "utf8");
    const originalContent = fs.readFileSync(CHANGELOG_PATH, "utf8");

    // Backup the original CHANGELOG.md
    console.log("Creating backup of CHANGELOG.md...");
    fs.copyFileSync(CHANGELOG_PATH, BACKUP_PATH);
    backupCreated = true;

    // Combine the changelogs: fork content first, then original
    // Add a separator comment between them
    const combinedContent = `${forkContent.trim()}\n\n---\n\n${originalContent}`;

    // Write the combined content
    console.log("Combining changelogs for packaging...");
    fs.writeFileSync(CHANGELOG_PATH, combinedContent, "utf8");

    // Run vsce package with any additional arguments
    const vsceCommand = `npx @vscode/vsce package ${vsceArgs}`;
    console.log(`Running: ${vsceCommand}`);
    execSync(vsceCommand, { stdio: "inherit", cwd: rootDir });

    console.log("\nPackage created successfully!");
  } catch (error) {
    console.error("\nError during packaging:", error.message);
    process.exitCode = 1;
  } finally {
    // Always restore the original CHANGELOG.md
    if (backupCreated) {
      console.log("Restoring original CHANGELOG.md...");
      fs.copyFileSync(BACKUP_PATH, CHANGELOG_PATH);
      fs.unlinkSync(BACKUP_PATH);
      console.log("Restored.");
    }
  }
}

main();
