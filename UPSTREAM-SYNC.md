# Upstream Sync Log

This file tracks which upstream commits from [sassoftware/vscode-sas-extension](https://github.com/sassoftware/vscode-sas-extension) have been reviewed for inclusion in this fork.

## How to review upstream changes

```bash
# See commits on upstream main that are not in this branch
git log sasstudio-web..main --oneline --format="%h %as %s"

# Cherry-pick a specific commit (resolve conflicts as needed)
git cherry-pick <sha>

# Cherry-pick a range
git cherry-pick <older-sha>^..<newer-sha>
```

After reviewing a batch, update the table below and bump the "Last reviewed commit" entry.

---

## Last reviewed upstream commit

- **Commit:** `96a2c8f` — Update package.json (version bump to 1.19.1)
- **Date on upstream:** 2026-03-27
- **Reviewed on:** 2026-04-10

## Review log

| Date reviewed | Upstream commit range | Disposition |
|---|---|---|
| 2026-04-10 | up to `96a2c8f` (1.19.1) | Fork diverged here. Upstream 1.19.1 ITC restricted execution policy fix skipped (ITC not used in this fork). |
