/**
 * Extension Source — Abstraction for extension discovery.
 *
 * A Source is responsible for discovering available extensions.
 * Examples: Built-in, Official Repository, Community Repository, Local Package, URL.
 *
 * No concrete sources are implemented here — only the interface.
 */

import type { Extension, ExtensionManifestV1, ExtensionId } from "../types";

/**
 * A discovered extension from a source.
 * Contains the manifest plus source-specific metadata.
 * Optionally carries the Extension runtime instance so SourceManager
 * can register it into the Registry (detect/install/etc.).
 */
export interface SourceExtension {
  /** The extension manifest. */
  manifest: ExtensionManifestV1;
  /** Which source discovered this extension. */
  sourceId: string;
  /** Source-specific metadata (e.g. download URL, repository info). */
  metadata?: Record<string, unknown>;
  /** Optional Extension runtime instance (wires detect/install/etc. into Registry). */
  extension?: Extension;
}

/** Result of a source query. */
export interface SourceQueryResult {
  /** Extensions discovered by this source. */
  extensions: SourceExtension[];
  /** Whether the query was successful. */
  success: boolean;
  /** Error message if query failed. */
  error?: string;
  /** Per-entry errors encountered during discovery. */
  errors?: Array<{ path: string; error: string }>;
  /** Timestamp of the query. */
  queriedAt: number;
}

/**
 * The Source interface.
 *
 * Each source is responsible for:
 * - Discovering available extensions
 * - Providing manifests for discovered extensions
 * - Resolving extension IDs to manifests
 *
 * Sources do NOT install, update, or manage extensions.
 * That responsibility belongs to the Manager and Installer services.
 */
export interface ExtensionSource {
  /** Unique identifier for this source. */
  readonly id: string;
  /** Human-readable name. */
  readonly displayName: string;
  /** Source priority (lower = higher priority). */
  readonly priority: number;
  /** Whether this source is currently enabled. */
  readonly enabled: boolean;

  /** Initialize the source (load config, validate credentials). */
  initialize(): Promise<void>;

  /** Discover all available extensions from this source. */
  discover(): Promise<SourceQueryResult>;

  /** Find a specific extension by ID. */
  findById(extensionId: ExtensionId): Promise<SourceExtension | null>;

  /** Check if a specific extension is available from this source. */
  isAvailable(extensionId: ExtensionId): Promise<boolean>;

  /** Destroy the source (release resources). */
  destroy(): Promise<void>;
}
