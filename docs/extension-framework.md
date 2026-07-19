# Extension Framework Architecture

## Overview

The Extension Framework is the permanent foundation for all extension functionality in LumaForge. It provides the type contracts, registry, manager API, source/release-provider abstractions, transaction system, and service interfaces that future features will build upon.

**No extension functionality exists yet.** This document describes the architecture only.

## Design Principles

- **Modular**: Each concern (registry, manager, sources, providers, services) lives in its own module.
- **Provider-agnostic**: No assumptions about where extensions come from (GitHub, HTTP, local, etc.).
- **Source-agnostic**: No assumptions about how extensions are discovered (built-in, repository, URL, etc.).
- **Future-proof**: Types define contracts; implementations can change without breaking consumers.
- **Strongly typed**: All interfaces are fully typed with TypeScript.
- **UI-independent**: The core framework has zero React dependencies.
- **Easily testable**: Registry is a pure in-memory Map; services are interfaces.

## Directory Structure

```
src/extensions/
    types/           Core framework types (ExtensionManifest, Extension, ExtensionStatus, etc.)
    registry/        In-memory extension registry (register, unregister, lookup, enumerate)
    manager/         Public API for extension lifecycle (install, update, enable, disable, etc.)
    sources/         ExtensionSource abstraction (discovery)
    providers/       ReleaseProvider abstraction (fetching releases)
    runtime/         Transaction system (atomic, rollbackable operations)
    services/        Service interfaces (Version, Status, Validation, Installer, Update)
    manifests/       (Reserved for manifest parsing — not yet implemented)
    builtin/         (Reserved for built-in extensions — currently empty)
    ui/              Placeholder Settings UI
    index.ts         Barrel export
```

## Extension Lifecycle

```
  ┌──────────┐
  │  Source   │  Discovers available extensions
  └────┬─────┘
       │ manifests
       ▼
  ┌──────────┐
  │ Registry │  Stores registered extensions in memory
  └────┬─────┘
       │ lookup
       ▼
  ┌──────────┐
  │ Manager  │  Orchestrates lifecycle operations
  └────┬─────┘
       │ delegates
       ▼
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │Installer │    │ Version  │    │ Status   │  Service implementations
  │ Service  │    │ Service  │    │ Service  │
  └────┬─────┘    └──────────┘    └──────────┘
       │ atomic
       ▼
  ┌──────────┐
  │Transaction│  Ensures rollback on failure
  └──────────┘
```

## Core Types

### ExtensionManifest

Static metadata describing an extension. Read from a manifest file or provided programmatically.

```typescript
interface ExtensionManifest {
  id: ExtensionId;           // Unique identifier (e.g. "opendeck")
  displayName: string;       // Human-readable name
  description: string;       // Short description
  version: string;           // Semver version string
  managedFiles: string[];    // Files managed by this extension
  author?: string;           // Author name or org
  homepage?: string;         // Homepage URL
  icon?: string;             // Icon path or URL
  longDescription?: string;  // Longer description (markdown)
  tags?: string[];           // Tags for categorization
  minimumHostVersion?: string; // Minimum host version required
  releaseProvider?: ReleaseProviderRef; // How to fetch updates
  supportedOperations?: ExtensionOperationType[];
  behavior?: ExtensionBehavior; // Behavioral effects when enabled
}
```

### Extension

Runtime interface that every extension must implement.

```typescript
interface Extension {
  readonly manifest: ExtensionManifest;
  detect(hostPath: string): Promise<ExtensionDetectionResult>;
  install(options): Promise<ExtensionOperationResult>;
  update(options): Promise<ExtensionOperationResult>;
  enable(options): Promise<ExtensionOperationResult>;
  disable(options): Promise<ExtensionOperationResult>;
  uninstall(options): Promise<ExtensionOperationResult>;
  getInstalledVersion(hostPath: string): Promise<string | null>;
  getLatestVersion(): Promise<string | null>;
  getStatus(hostPath: string): Promise<ExtensionStatus>;
  getBehavior?(): ExtensionBehavior;
}
```

### ExtensionStatus

Lifecycle status of an extension: `available | installing | installed | enabled | disabled | updating | error | uninstalling`.

### ExtensionBehavior

Behavioral effects an extension declares when enabled (e.g. `luaOwnershipOverride`).

## Registry

The Registry is a **pure, synchronous, in-memory Map** of Extension objects. It has no I/O, no network calls, and no side effects.

```typescript
registerExtension(extension: Extension): void
unregisterExtension(extensionId: ExtensionId): boolean
getExtension(extensionId: ExtensionId): Extension | undefined
hasExtension(extensionId: ExtensionId): boolean
getAllExtensions(): Extension[]
getExtensionCount(): number
getAllManifests(): ExtensionManifest[]
registerExtensions(extensions: Extension[]): void
clearRegistry(): void
```

## Manager

The Manager is the **single entry point** for all extension lifecycle operations. It delegates to services and notifies subscribers on state changes.

```typescript
// Queries
getExtensionManagerState(): Promise<ExtensionManagerState>

// Operations (currently stub — throw "Not implemented")
installExtension(extensionId, options): Promise<ExtensionOperationResult>
updateExtension(extensionId, options): Promise<ExtensionOperationResult>
enableExtension(extensionId, options): Promise<ExtensionOperationResult>
disableExtension(extensionId, options): Promise<ExtensionOperationResult>
uninstallExtension(extensionId, options): Promise<ExtensionOperationResult>
refreshExtensionState(extensionId, hostPath): Promise<void>

// Subscription
subscribeExtensionManager(listener): () => void
```

## Source System

A Source discovers available extensions. The framework supports multiple sources simultaneously.

```typescript
interface ExtensionSource {
  readonly id: string;
  readonly displayName: string;
  readonly priority: number;
  readonly enabled: boolean;
  initialize(): Promise<void>;
  discover(): Promise<SourceQueryResult>;
  findById(extensionId): Promise<SourceExtension | null>;
  isAvailable(extensionId): Promise<boolean>;
  destroy(): Promise<void>;
}
```

### Future Sources
- **Built-in Source**: Extensions bundled with the launcher.
- **Official Repository**: Curated extensions from the LumaForge team.
- **Community Repository**: Third-party extension sources.
- **Local Package**: Install from a local `.zip` file.
- **URL Source**: Install from a direct download URL.

## Release Providers

A ReleaseProvider fetches release information from a hosting service.

```typescript
interface ReleaseProvider {
  readonly id: string;
  readonly displayName: string;
  fetchLatest(config): Promise<Release | null>;
  fetchAll(config, limit?): Promise<ReleaseFetchResult>;
  findByTag(config, tag): Promise<Release | null>;
  findAsset(release, assetName): ReleaseAsset | null;
}
```

### Future Providers
- **GitHub Releases**: Fetch from GitHub API.
- **HTTP**: Fetch from a generic HTTP endpoint.
- **ZIP**: Install from a local or remote ZIP file.
- **Custom**: Provider-specific logic.

## Transaction System

The Transaction System ensures atomic, rollbackable operations.

```typescript
interface TransactionStep {
  name: string;
  execute(): Promise<void>;
  rollback?(): Promise<void>;
}

interface Transaction {
  name: string;
  steps: TransactionStep[];
}

interface TransactionExecutor {
  execute(transaction: Transaction): Promise<TransactionResult>;
}
```

If any step fails, all completed steps are rolled back in reverse order.

## Service Interfaces

Services are independent interfaces with no inter-dependencies.

| Service | Responsibility |
|---------|---------------|
| `VersionService` | Detect and compare extension versions |
| `StatusService` | Detect extension status from disk |
| `ValidationService` | Validate manifests, files, host compatibility |
| `InstallerService` | Download and extract extension files |
| `UpdateService` | Check for and apply updates |

## Dependency Rules

Nothing inside the framework may depend on:
- OpenSteamTool
- GitHub
- Steam
- Filesystem
- Network
- Tauri
- Rust

Every dependency points inward (types → nothing, registry → types, manager → types + registry).

## Future Roadmap

1. **Manifest Parser**: Parse `extension.json` from disk.
2. **Built-in Source**: Bundle extensions with the launcher.
3. **Official Repository**: Curated extension marketplace.
4. **GitHub Provider**: Implement `ReleaseProvider` for GitHub Releases.
5. **Installer Service**: Download, extract, and place extension files.
6. **Transaction Executor**: Implement atomic file operations.
7. **Settings UI**: Extension cards with install/enable/disable/update.
8. **Update Checker**: Periodic background update checks.
9. **Community Sources**: Third-party extension repositories.
10. **Extension Behaviors**: Host application hooks for extension effects.
