# Extension Manifest Specification v1

The extension manifest is the single source of truth for every LumaForge extension. It is a declarative JSON document that describes the extension's identity, files, permissions, capabilities, strategies, and behavior. Extensions never execute arbitrary code — the launcher interprets these declarations to perform all operations.

## Schema Versioning

Every manifest must declare `schemaVersion`. The current and only valid version is **1**.

```json
{ "schemaVersion": 1 }
```

Future schema versions will be backwards-compatible with v1. Extensions using unknown schema versions are rejected.

## Required Fields

| Field | Type | Rule |
|-------|------|------|
| `schemaVersion` | `1` | Must be exactly `1` |
| `id` | string | `/^[a-z0-9][a-z0-9-]{0,63}$/` — lowercase, alphanumeric + hyphens, max 64 chars |
| `name` | string | Same rules as `id` — should match `id` |
| `displayName` | string | Human-readable, max 128 characters |
| `description` | string | Short description, max 256 characters |
| `version` | string | SemVer 2.0.0 format |
| `managedFiles` | array | Files managed by this extension (see Managed Files) |

## Optional Fields

### Identity & Metadata

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `longDescription` | string | — | Extended description in Markdown, max 16384 chars |
| `summary` | string | — | One-line tagline, max 128 chars |
| `author` | string | — | Author name or organization, max 128 chars |
| `authorEmail` | string | — | Contact email |
| `homepage` | string | — | Homepage URL |
| `repository` | string | — | Source code repository URL |
| `license` | string | — | SPDX license identifier |
| `icon` | string | — | Icon filename (relative to extension directory) |
| `banner` | string | — | Banner filename (relative to extension directory) |
| `screenshots` | string[] | — | Screenshot filenames (relative to extension directory) |
| `categories` | string[] | — | Categories (max 3) |
| `tags` | string[] | — | Tags for search/discovery |

### Version Constraints

| Field | Type | Description |
|-------|------|-------------|
| `minimumLauncherVersion` | string | Minimum SemVer launcher version required |
| `maximumLauncherVersion` | string | Maximum SemVer launcher version supported |

### Manifest Extension

| Field | Type | Description |
|-------|------|-------------|
| `metadata` | Record<string, unknown> | Arbitrary key-value pairs for future use |

---

## Permissions

Extensions declare all permissions they require. The launcher prompts the user for consent before installation.

### Permission Format

```json
"permissions": [
  { "id": "filesystem.read", "reason": "Read Steam appinfo files", "optional": false },
  { "id": "steam.appdata", "reason": "Access Steam directories" },
  { "id": "network.http", "optional": true }
]
```

### Permission Namespace

| Namespace | Permissions | Description |
|-----------|-------------|-------------|
| `filesystem.*` | `read`, `write`, `delete` | File and directory operations on the host path |
| `network.*` | `http`, `websocket` | Network access |
| `steam.*` | `appdata`, `config`, `appmanifest` | Steam platform integration |
| `system.*` | `processes`, `registry` | System-level operations |
| `ui.*` | `settings`, `dashboard`, `sidebar`, `notifications` | User interface extensions |
| `*` | — | All permissions (requires explicit user consent) |

### Wildcard Permissions

- `"filesystem.*"` grants all filesystem permissions
- `"network.*"` grants all network permissions
- `"*"` grants every permission (launcher shows full consent dialog)

---

## Capabilities

Extensions declare capabilities they provide to the launcher. These are informational — the launcher reads them to understand what the extension does.

### Capability Format

```json
"capabilities": [
  { "id": "steam-tool", "version": "1.0", "description": "Modifies Steam runtime behavior" }
]
```

### Well-Known Capabilities

| Capability | Description |
|------------|-------------|
| `steam-tool` | Modifies Steam runtime behavior |
| `metadata-provider` | Provides game metadata |
| `save-manager` | Manages game save files |
| `achievement-provider` | Provides achievement data/tracking |
| `launcher-integration` | Integrates with the launcher UI |
| `network-service` | Provides network functionality |
| `overlay` | Renders an in-game overlay |
| `game-detection` | Detects installed games |
| `backup-provider` | Provides backup functionality |
| `media-provider` | Provides game artwork/media |
| `lua-runtime` | Provides Lua script execution |

Capabilities are extensible — new values may be added in future schema versions.

---

## Managed Files

Extensions declare the files they manage declaratively. The launcher interprets these descriptors to perform file operations. Extensions never execute arbitrary file operations.

### File Descriptor Format

```json
"managedFiles": [
  {
    "path": "gameoverlayrenderer.dll",
    "isExecutable": true,
    "replaceStrategy": "if-different",
    "backupStrategy": "rename",
    "validationStrategy": "checksum",
    "checksum": "sha256-abc123def456..."
  },
  {
    "path": "config.ini",
    "required": false,
    "replaceStrategy": "never",
    "backupStrategy": "none"
  }
]
```

### File Descriptor Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | — | Relative path from extension directory |
| `required` | boolean | `true` | Whether this file is required for the extension to function |
| `optional` | boolean | `false` | Whether this file is optional |
| `replaceStrategy` | string | `"always"` | How to handle replacement during updates |
| `backupStrategy` | string | `"rename"` | How to handle backup during enable/disable |
| `validationStrategy` | string | `"exists"` | How to validate the file after installation |
| `checksum` | string | — | Expected SHA-256 checksum (when `validationStrategy` is `"checksum"`) |
| `expectedSize` | number | — | Expected file size in bytes (when `validationStrategy` is `"size"`) |
| `isExecutable` | boolean | `false` | Whether this file is an executable (DLL, EXE) |
| `excludeFromVcs` | boolean | `false` | Whether this file should be excluded from version control |

### Replace Strategies

| Strategy | Description |
|----------|-------------|
| `always` | Always overwrite the existing file |
| `if-newer` | Only overwrite if the new file is newer |
| `if-different` | Only overwrite if content differs |
| `never` | Never overwrite (skip if exists) |

### Backup Strategies

| Strategy | Description |
|----------|-------------|
| `rename` | Rename file (e.g. `.dll` → `.dll.bak`) |
| `copy` | Copy to `.bak`, leave original |
| `none` | No backup (file is deleted on disable) |
| `custom` | Extension handles its own backup |

### Validation Strategies

| Strategy | Description |
|----------|-------------|
| `exists` | Check file exists on disk |
| `checksum` | Verify SHA-256 checksum matches `checksum` field |
| `size` | Verify file size matches `expectedSize` field |
| `none` | No validation |

---

## Strategies

Extensions declare three strategy types that describe how the launcher should perform lifecycle operations.

### Install Strategy

```json
"installStrategy": {
  "type": "transaction-copy"
}
```

| Type | Description |
|------|-------------|
| `transaction-copy` | Copy files from source to target (atomic with rollback) |
| `transaction-move` | Move files from source to target (atomic with rollback) |
| `transaction-rename` | Rename files (e.g. `.bak` → `.dll`) |
| `transaction-extract` | Extract archive (ZIP) to target |
| `transaction-replace` | Replace entire directory contents |
| `custom` | Extension provides manifest only, launcher decides |

### Toggle Strategy (Enable/Disable)

```json
"toggleStrategy": {
  "type": "rename"
}
```

| Type | Description |
|------|-------------|
| `rename` | Rename files (e.g. `.dll` ↔ `.dll.bak`) |
| `configuration` | Toggle via configuration file |
| `service` | Start/stop as a service |
| `none` | No enable/disable (always active when installed) |
| `custom` | Custom strategy |

### Update Strategy

```json
"updateStrategy": {
  "type": "replace",
  "autoCheck": true,
  "autoInstall": false
}
```

| Type | Description |
|------|-------------|
| `replace` | Replace all files with new version |
| `patch` | Apply incremental patch |
| `download` | Download full package from release provider |
| `custom` | Custom strategy |

---

## Release Provider

Extensions declare how the launcher should fetch releases and updates. The release provider is read by the launcher's generic release service — no extension-specific code exists in the service.

### Provider Types

| Provider | Description |
|----------|-------------|
| `github` | Fetch releases from a GitHub repository |
| `http` | Fetch releases from an HTTP server with manifest/asset URLs |
| `git` | Clone a Git repository |
| `local` | Use a local directory as the release source |
| `mirror` | Use a mirror/proxy of another provider |
| `custom` | Extension provides its own update logic |

### GitHub Provider

```json
"releaseProvider": {
  "provider": "github",
  "config": {
    "owner": "developer",
    "repo": "extension-repo",
    "tagPattern": "v*",
    "assetPattern": "*.zip",
    "includePrereleases": false
  }
}
```

#### Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owner` | string | Yes | GitHub organization or user |
| `repo` | string | Yes | Repository name |
| `tagPattern` | string | No | Glob pattern to match release tags (e.g. `v*`, `release-*`) |
| `assetPattern` | string | No | Glob pattern to match asset filenames (e.g. `*.zip`, `mod-*.tar.gz`) |
| `includePrereleases` | boolean | No | Include pre-release versions (default: `false`) |

#### How It Works

1. The launcher builds a slug from `owner/repo` (e.g. `OpenSteam001/OpenSteamTool`)
2. Fetches releases from `https://api.github.com/repos/{owner}/{repo}/releases`
3. Filters by `tagPattern` if provided (glob → regex)
4. For each remaining release, confirms at least one asset matches `assetPattern`
5. Returns the newest matching release

#### Caching

- Releases are cached per `owner/repo` slug for 5 minutes
- Deduplicates in-flight requests to the same repo
- Callers can force-refresh to bypass the cache

### HTTP Provider

```json
"releaseProvider": {
  "provider": "http",
  "config": {
    "baseUrl": "https://releases.example.com/extensions",
    "manifestUrl": "{baseUrl}/{version}/manifest.json",
    "assetUrl": "{baseUrl}/{version}/package.zip"
  }
}
```

### Extension Usage

Any extension can use the release provider service generically. No `if (id === "extension-name")` branching exists in the service.

```typescript
import { fetchReleasesFromConfig, selectLatestMatchingRelease } from "../../services/githubReleaseService";
import type { GitHubReleaseProviderConfig } from "../../types";

// Read config from manifest
const config: GitHubReleaseProviderConfig = {
  owner: "MyOrg",
  repo: "MyTool",
  tagPattern: "v*",
  assetPattern: "*.zip",
};

// Fetch and select
const releases = await fetchReleasesFromConfig(config);
const latest = selectLatestMatchingRelease(releases, config);
```

### Validation

The launcher validates the `releaseProvider` at manifest load time:
- `provider` must be a known provider type
- `config` must contain all required fields for that provider
- Unknown config fields are ignored (forward-compatible)

---

## Behavior

Extensions declare behavioral effects that influence the launcher's own behavior.

```json
"behavior": {
  "luaOwnershipOverride": true,
  "injectsDll": true,
  "modifiesStorePage": false,
  "addsGameEntries": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `luaOwnershipOverride` | boolean | Treat Lua-active games as owned in Store |
| `injectsDll` | boolean | Extension injects DLLs into the Steam process |
| `modifiesStorePage` | boolean | Extension modifies the Steam Store page |
| `addsGameEntries` | boolean | Extension adds games to the library |

Additional arbitrary key-value pairs are allowed.

---

## Validation

Extensions can declare validation rules for post-installation checks.

```json
"validation": {
  "requiredFiles": ["gameoverlayrenderer.dll", "config.ini"],
  "maxTotalSize": 10485760,
  "packageChecksum": "sha256-abc123..."
}
```

---

## Complete Example

```json
{
  "schemaVersion": 1,
  "id": "opendeck",
  "name": "opendeck",
  "displayName": "OpenDeck",
  "description": "Steam custom controller support",
  "longDescription": "# OpenDeck\n\nOpenDeck provides custom controller configuration...",
  "summary": "Custom controller support for Steam",
  "version": "1.2.0",
  "minimumLauncherVersion": "1.0.0",
  "author": "LumaForge Team",
  "homepage": "https://github.com/lumaforge/opendeck",
  "repository": "https://github.com/lumaforge/opendeck",
  "license": "MIT",
  "icon": "icon.png",
  "categories": ["input", "steam"],
  "tags": ["controller", "input", "steam"],
  "managedFiles": [
    {
      "path": "gameoverlayrenderer.dll",
      "isExecutable": true,
      "replaceStrategy": "if-different",
      "backupStrategy": "rename",
      "validationStrategy": "checksum",
      "checksum": "sha256-abc123..."
    }
  ],
  "permissions": [
    { "id": "filesystem.read", "reason": "Read Steam configuration" },
    { "id": "steam.appdata", "reason": "Access Steam directories" },
    { "id": "system.processes", "reason": "Detect Steam process" }
  ],
  "capabilities": [
    { "id": "steam-tool", "version": "1.0", "description": "Modifies Steam runtime" }
  ],
  "installStrategy": { "type": "transaction-copy" },
  "toggleStrategy": { "type": "rename" },
  "updateStrategy": { "type": "replace", "autoCheck": true },
  "releaseProvider": {
    "provider": "github",
    "config": { "owner": "lumaforge", "repo": "opendeck", "assetPattern": "*.zip" }
  },
  "behavior": { "injectsDll": true }
}
```
