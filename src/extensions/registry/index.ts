/**
 * Extension Registry — In-memory store of registered extensions.
 *
 * The Registry is a pure, synchronous, in-memory Map of Extension objects.
 * It has no side effects, no I/O, and no network calls.
 *
 * Responsibilities:
 * - Register/unregister extensions
 * - Look up extensions by ID
 * - List all registered extensions
 * - Clear the registry
 *
 * The Registry does NOT install, update, enable, or disable extensions.
 * That responsibility belongs to the Manager.
 */

import type { Extension, ExtensionId, ExtensionManifestV1 } from "../types";

const _registry = new Map<ExtensionId, Extension>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register an extension.
 * If an extension with the same ID already exists, it is replaced.
 */
export function registerExtension(extension: Extension): void {
  _registry.set(extension.manifest.id, extension);
}

/**
 * Unregister an extension by ID.
 * @returns true if the extension was found and removed, false otherwise.
 */
export function unregisterExtension(extensionId: ExtensionId): boolean {
  return _registry.delete(extensionId);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Find an extension by ID.
 * @returns The extension, or undefined if not found.
 */
export function getExtension(extensionId: ExtensionId): Extension | undefined {
  return _registry.get(extensionId);
}

/**
 * Check if an extension is registered.
 */
export function hasExtension(extensionId: ExtensionId): boolean {
  return _registry.has(extensionId);
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

/**
 * Get all registered extensions.
 * @returns A new array (not a reference to the internal Map).
 */
export function getAllExtensions(): Extension[] {
  return Array.from(_registry.values());
}

/**
 * Get the number of registered extensions.
 */
export function getExtensionCount(): number {
  return _registry.size;
}

/**
 * Get manifests for all registered extensions.
 */
export function getAllManifests(): ExtensionManifestV1[] {
  return getAllExtensions().map((e) => e.manifest);
}

// ---------------------------------------------------------------------------
// Bulk Operations
// ---------------------------------------------------------------------------

/**
 * Register multiple extensions at once.
 */
export function registerExtensions(extensions: Extension[]): void {
  for (const ext of extensions) {
    _registry.set(ext.manifest.id, ext);
  }
}

/**
 * Clear the entire registry.
 */
export function clearRegistry(): void {
  _registry.clear();
}
