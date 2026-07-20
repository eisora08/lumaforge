/**
 * Wire Extension Runtime — Shared fallback for creating DeclarativeExtension
 * from a manifest that has managedFiles but no hand-written factory.
 *
 * Used by:
 * - BuiltInSource: when no factory is registered for a built-in extension dir
 * - SourceManager: when a source (e.g. RepositorySource) provides a manifest
 *   but no Extension runtime instance
 *
 * The extension spec design principle: "Extensions describe themselves.
 * The launcher performs all operations." — DeclarativeExtension implements
 * all 6 lifecycle operations from manifest data using generic services.
 */

import type { Extension, ExtensionManifestV1 } from "../types";

/**
 * Attempt to create a DeclarativeExtension for a manifest.
 *
 * Returns an Extension instance when:
 * - manifest.managedFiles exists and has at least one entry
 *
 * Returns undefined when:
 * - manifest has no managedFiles or the array is empty
 * - DeclarativeExtension module fails to load (non-fatal)
 */
export async function tryCreateDeclarativeExtension(
  manifest: ExtensionManifestV1,
): Promise<Extension | undefined> {
  if (!manifest.managedFiles || manifest.managedFiles.length === 0) {
    return undefined;
  }

  try {
    const { DeclarativeExtension } = await import("./DeclarativeExtension");
    return new DeclarativeExtension(manifest);
  } catch (err) {
    console.warn(
      `[WIRE_RUNTIME] Failed to create DeclarativeExtension for "${manifest.id}":`,
      err,
    );
    return undefined;
  }
}
