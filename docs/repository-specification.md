# Repository Specification v1

A repository is a collection of extensions discoverable by the LumaForge launcher. Repositories host an `index.json` file that lists all available extensions. Multiple repositories can be configured simultaneously, each with its own priority.

## Repository Index Format

The repository index (`index.json`) is the entry point for discovering extensions.

```json
{
  "schemaVersion": 1,
  "id": "official",
  "name": "Official Extensions",
  "description": "Verified extensions maintained by the LumaForge team",
  "homepage": "https://extensions.lumaforge.com",
  "maintainer": "LumaForge Team",
  "version": "1.0.0",
  "updatedAt": "2026-01-15T10:00:00Z",
  "extensions": [
    {
      "id": "opendeck",
      "displayName": "OpenDeck",
      "description": "Custom controller support for Steam",
      "version": "1.2.0",
      "author": "LumaForge Team",
      "categories": ["input", "steam"],
      "tags": ["controller", "input"],
      "icon": "icons/opendeck.png",
      "manifestUrl": "extensions/opendeck/manifest.json",
      "minimumLauncherVersion": "1.0.0",
      "capabilities": ["steam-tool"],
      "verified": true
    }
  ]
}
```

## Index Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schemaVersion` | `1` | Yes | Repository schema version |
| `id` | string | Yes | Unique repository identifier (e.g. `"official"`, `"community"`) |
| `name` | string | Yes | Human-readable repository name |
| `description` | string | No | Repository description |
| `homepage` | string | No | Repository homepage URL |
| `maintainer` | string | No | Repository maintainer |
| `version` | string | Yes | SemVer version of the repository itself |
| `updatedAt` | string | Yes | ISO 8601 timestamp of last update |
| `extensions` | ExtensionEntry[] | Yes | List of available extensions |

## Extension Entry Fields

Each entry in the `extensions` array describes one available extension.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Extension id (globally unique) |
| `displayName` | string | Yes | Human-readable name |
| `description` | string | Yes | Short description |
| `version` | string | Yes | Latest available version (SemVer) |
| `author` | string | No | Extension author |
| `categories` | string[] | No | Categories (max 3) |
| `tags` | string[] | No | Search tags |
| `icon` | string | No | Icon path (relative to repository root) |
| `manifestUrl` | string | Yes | URL to the full manifest (relative to repository root) |
| `minimumLauncherVersion` | string | No | Minimum launcher version required |
| `capabilities` | string[] | No | Capabilities provided by this extension |
| `verified` | boolean | No | Whether this extension is verified/trusted |

## Directory Structure

```
repository/
├── index.json                          # Repository index
├── icons/
│   ├── opendeck.png                    # Extension icons
│   └── goldberg.png
└── extensions/
    ├── opendeck/
    │   └── manifest.json               # Full extension manifest
    └── goldberg/
        └── manifest.json
```

## Manifest URL Resolution

The `manifestUrl` in each extension entry is relative to the repository root. For example:

- Repository base: `https://extensions.lumaforge.com/official/`
- `manifestUrl`: `extensions/opendeck/manifest.json`
- Resolved: `https://extensions.lumaforge.com/official/extensions/opendeck/manifest.json`

## Multiple Repositories

The launcher supports multiple repositories with priority ordering:

```json
{
  "repositories": [
    { "id": "official", "url": "https://extensions.lumaforge.com/official/index.json", "priority": 10 },
    { "id": "community", "url": "https://extensions.lumaforge.com/community/index.json", "priority": 20 },
    { "id": "local", "path": "C:/extensions/index.json", "priority": 30 }
  ]
}
```

When the same extension ID exists in multiple repositories, the one from the highest-priority repository (lowest `priority` value) wins.

## Fetching Strategy

1. Launcher fetches each repository's `index.json`
2. Entries are merged by extension ID (highest priority wins)
3. For each extension, the full `manifest.json` is fetched on-demand (when user views details)
4. Icons are fetched on-demand (when the UI renders the extension)

## Caching

- `index.json` is cached locally with a configurable TTL (default: 1 hour)
- Full `manifest.json` is cached after first fetch
- Stale caches are refreshed in the background
- Force refresh available via UI action

## Validation

The launcher validates:

1. `index.json` matches the `RepositoryIndex` schema
2. Each `manifestUrl` resolves to a valid `ExtensionManifestV1`
3. Extension IDs in the index match the manifest `id` field
4. Version strings are valid SemVer
5. Icon URLs resolve to valid image files

## Error Handling

- Failed repository fetch: skip that repository, use cached version if available
- Invalid index: skip entire repository, log warning
- Missing manifest: skip that extension, continue with others
- Corrupt icon: show placeholder, continue loading
