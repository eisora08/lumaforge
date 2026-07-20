/**
 * Extension Loader — Barrel Export
 *
 * Provides the dynamic discovery pipeline for Lua extensions:
 * scan → parse → load → register.
 */

export { scanExtensionsDir } from "./scanner";
export type { ScanResult } from "./scanner";

export { loadExtensionsFromAppData } from "./loader";
export type { LoaderResult } from "./loader";

export { createLuaExtension } from "./createLuaExtension";
