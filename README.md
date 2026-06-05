# SAS Studio Web Editor — VS Code Extension

> **Personal fork** of [sassoftware/vscode-sas-extension](https://github.com/sassoftware/vscode-sas-extension).
> Not affiliated with or endorsed by SAS Institute Inc.

This fork adds a **SAS Studio Web** connection type that lets you connect VS Code directly to an existing SAS Studio instance.

## What's new

See [CHANGELOG.md](./CHANGELOG.md) for the full history.

## Setting up a SAS Studio Web connection

Open VS Code settings and add a profile with `connectionType: "studioweb"` then select it as the active connection profile.

```json
"SAS.connectionProfiles": {
  "profiles": {
    "studioweb": {
      "connectionType": "studioweb",
      "endpoint": "https://your-server/SASStudio/38",
    }
  }
}
```

## Other connection types

This fork retains all connection types from the upstream extension: SAS Viya (REST), SAS 9 ITC, SAS 9 SSH, and SAS 9 IOM (COM/local). See the [upstream documentation](https://sassoftware.github.io/vscode-sas-extension/Configurations/) for those.

## License

Apache License 2.0. Based on work by SAS Institute Inc. See [LICENSE](./LICENSE).
