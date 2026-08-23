# Source Specification v1

A Source is the launcher's abstraction for discovering available extensions. Each source represents a different origin: built-in extensions, official repositories, community repositories, local directories, individual manifest files, direct URLs, or git repositories.

Sources are pluggable — the launcher supports multiple sources simultaneously. Each source is independent and responsible only for discovery, not for installation or management.

## Source Types

| Type | Description | Example |
|------|-------------|---------|
| `builtin` | Extensions bundled with the launcher | Ships with LumaForge |
| `repository` | Official or community repository | Official Extensions repo |
| `directory` | Local directory scan | `C:\extensions\` |
| `manifest` | Single manifest file | `C:\extensions\opendeck\manifest.json` |
| `url` | Direct URL to a manifest | `https://example.com/manifest.json` |
| `git` | Git repository | `https://github.com/user/ext.git` |
| `custom` | Custom source type (future) | — |

## Source Configuration

```json
{
  "id": "official",
  "displayName": "Official Extensions",
  "type": "repository",
  "priority": 10,
  "enabled": true,
  "config": {
    "url": "https://extensions.lumaforge.com/official/index.json",
    "refreshInterval": 3600
  }
}
```

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | Unique source identifier |
| `displayName` | string | — | Human-readable name |
| `type` | SourceType | — | Source type |
| `priority` | number | `100` | Priority (lower = higher priority) |
| `enabled` | boolean | `true` | Whether this source is active |
| `config` | Record | — | Source-specific configuration |

## Source Interface

Each source implements the `ExtensionSource` interface:

```typescript
interface ExtensionSource {
  readonly id: string;
  readonly displayName: string;
  readonly priority: number;
  readonly enabled: boolean;

  initialize(): Promise<void>;
  discover(): Promise<SourceQueryResult>;
  findById(extensionId: string): Promise<SourceExtension | null>;
  isAvailable(extensionId: string): Promise<boolean>;
  destroy(): Promise<void>;
}
```

### Lifecycle

1. **initialize()** — Load configuration, validate credentials, prepare for discovery
2. **discover()** — Fetch all available extensions from this source
3. **findById(id)** — Find a specific extension by ID
4. **isAvailable(id)** — Quick check if an extension exists in this source
5. **destroy()** — Release resources (network connections, caches)

### Query Result

```typescript
interface SourceQueryResult {
  extensions: SourceExtension[];
  success: boolean;
  error?: string;
  queriedAt: number;
}
```

### Source Extension

```typescript
interface SourceExtension {
  manifest: ExtensionManifestV1;
  sourceId: string;
  metadata?: Record<string, unknown>;
}
```

## Built-in Source

Extensions shipped with the launcher. These are always available and have the highest priority (priority: 0).

```json
{
  "id": "builtin",
  "displayName": "Built-in Extensions",
  "type": "builtin",
  "priority": 0,
  "enabled": true,
  "config": {}
}
```

## Repository Source

Fetches extensions from a repository index. This is the primary way to discover community extensions.

```json
{
  "id": "official",
  "displayName": "Official Extensions",
  "type": "repository",
  "priority": 10,
  "enabled": true,
  "config": {
    "url": "https://extensions.lumaforge.com/official/index.json"
  }
}
```

## Directory Source

Scans a local directory for `manifest.json` files.

```json
{
  "id": "local-dev",
  "displayName": "Local Development",
  "type": "directory",
  "priority": 50,
  "enabled": true,
  "config": {
    "path": "C:\\Users\\dev\\extensions",
    "recursive": true,
    "manifestPattern": "manifest.json"
  }
}
```

## Manifest Source

Loads a single extension from a specific manifest file.

```json
{
  "id": "custom-ext",
  "displayName": "Custom Extension",
  "type": "manifest",
  "priority": 30,
  "enabled": true,
  "config": {
    "path": "C:\\extensions\\opendeck\\manifest.json"
  }
}
```

## URL Source

Fetches a manifest from a direct URL.

```json
{
  "id": "beta-ext",
  "displayName": "Beta Extension",
  "type": "url",
  "priority": 40,
  "enabled": true,
  "config": {
    "url": "https://beta.example.com/extensions/opendeck/manifest.json"
  }
}
```

## Git Source

Clones or pulls a git repository and reads manifests from it.

```json
{
  "id": "dev-repo",
  "displayName": "Development Repository",
  "type": "git",
  "priority": 60,
  "enabled": true,
  "config": {
    "url": "https://github.com/user/extensions.git",
    "branch": "main",
    "manifestPattern": "**/manifest.json"
  }
}
```

## Priority and Conflict Resolution

When multiple sources provide the same extension ID:

1. The source with the **lowest priority number** wins
2. If two sources have the same priority, the **most recently queried** source wins
3. Users can override source priority in the launcher settings

## Source Lifecycle Management

The launcher manages sources as follows:

1. **Boot**: Initialize all enabled sources
2. **Discovery**: Query all sources in priority order
3. **Merge**: Combine results, resolving conflicts by priority
4. **Cache**: Cache results per-source with configurable TTL
5. **Refresh**: Periodically re-query sources (background)
6. **Destroy**: Clean up on shutdown or when a source is disabled

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Source initialization fails | Log warning, mark source as unavailable, continue |
| Discovery fails | Use cached results, retry on next cycle |
| Individual manifest fetch fails | Skip that extension, log warning |
| Network timeout | Retry with exponential backoff (max 3 retries) |
| Invalid manifest | Skip extension, log validation errors |

## User-Facing Source Management

Users can:

- Enable/disable sources in Settings
- Add custom sources (directory, URL, manifest, git)
- Set source priorities
- Force refresh a specific source
- View source status (online/offline/error)
- Remove custom sources
