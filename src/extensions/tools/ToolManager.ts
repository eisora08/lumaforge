/**
 * Tool Manager — Central registry and orchestration layer for game tools.
 *
 * Discovers tools from registered extensions with `surfaces: ["tools"]`
 * and `metadata.toolConfig` in their manifests. Provides detect/apply/revert
 * operations for applying tool files to individual game install directories.
 *
 * Applied fixes are tracked in-memory and persisted to localStorage.
 */

import type { ExtensionManifestV1 } from "../types";
import type {
  Tool,
  ToolId,
  ToolDetectionResult,
  ToolApplyResult,
  AppliedFix,
  ToolRegistrySnapshot,
} from "./types";
import type { GameContext } from "../runtime/criteriaEvaluator";
import { APPLIED_FIXES_KEY, MAX_APPLIED_FIXES } from "./types";
import { tryCreateDeclarativeTool, extractToolConfig } from "./DeclarativeTool";
import { subscribeExtensionManager, getExtensionsBySurface, getRegisteredExtension } from "../manager/index";
import { evaluateManifestCriteria } from "../runtime/criteriaEvaluator";
import { showSuccess, showError } from "../../components/toast/GameToast";

// =============================================================================
// Types
// =============================================================================

type Listener = () => void;

// =============================================================================
// State
// =============================================================================

const _tools = new Map<ToolId, Tool>();
const _listeners = new Set<Listener>();
const _appliedFixes = new Map<string, AppliedFix>(); // key: "toolId:gameId"
let _initialized = false;

// =============================================================================
// Notifications
// =============================================================================

function _notify(): void {
  for (const listener of _listeners) {
    listener();
  }
}

/**
 * Subscribe to ToolManager state changes.
 * Returns an unsubscribe function.
 */
export function subscribeToolManager(listener: Listener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

// =============================================================================
// Applied Fixes Persistence
// =============================================================================

function _loadAppliedFixes(): void {
  try {
    const raw = localStorage.getItem(APPLIED_FIXES_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as AppliedFix[];
    for (const fix of arr) {
      const key = `${fix.toolId}:${fix.gameId}`;
      _appliedFixes.set(key, fix);
    }
  } catch {
    // Corrupt data — start fresh
  }
}

function _persistAppliedFixes(): void {
  try {
    const arr = Array.from(_appliedFixes.values());
    // Enforce max limit
    if (arr.length > MAX_APPLIED_FIXES) {
      arr.sort((a, b) => b.appliedAt - a.appliedAt);
      arr.length = MAX_APPLIED_FIXES;
    }
    localStorage.setItem(APPLIED_FIXES_KEY, JSON.stringify(arr));
  } catch {
    // localStorage full or unavailable — non-fatal
  }
}

// =============================================================================
// Discovery
// =============================================================================

/**
 * Scan registered extensions for tools and rebuild the tool registry.
 * Called on init and when extension manager state changes.
 */
export function discoverTools(): void {
  const toolExtensions = getExtensionsBySurface("tools");

  _tools.clear();

  for (const registered of toolExtensions) {
    const manifest = registered.manifest;
    const toolConfig = extractToolConfig(manifest);

    if (!toolConfig) continue;

    // Try declarative first
    const declarative = tryCreateDeclarativeTool(manifest);
    if (declarative) {
      _tools.set(declarative.id, declarative);
      continue;
    }

    // For "custom" type — look up hand-written handler
    if (toolConfig.type === "custom" && toolConfig.customHandler) {
      const custom = _customHandlers.get(toolConfig.customHandler);
      if (custom) {
        _tools.set(manifest.id, custom(manifest, toolConfig));
        continue;
      }
    }
  }

  _notify();
}

/**
 * Initialize the ToolManager: load persisted data, discover tools,
 * and subscribe to extension manager changes.
 */
export function initToolManager(): void {
  if (_initialized) return;
  _initialized = true;

  _loadAppliedFixes();
  discoverTools();

  // Re-discover when extensions change
  subscribeExtensionManager(() => {
    discoverTools();
  });
}

// =============================================================================
// Registry
// =============================================================================

/**
 * Get a snapshot of all registered tools.
 */
export function getToolRegistrySnapshot(): ToolRegistrySnapshot {
  const tools = Array.from(_tools.values()).sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
  );
  return { tools, count: tools.length };
}

/**
 * Get a tool by ID.
 */
export function getTool(toolId: ToolId): Tool | undefined {
  return _tools.get(toolId);
}

/**
 * Get all registered tools.
 */
export function getAllTools(): Tool[] {
  return Array.from(_tools.values()).sort(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100),
  );
}

// =============================================================================
// Detection
// =============================================================================

/**
 * Build a GameContext from a game install directory.
 */
export function gameContextFromInstallDir(installDir: string): GameContext {
  // Extract appId from the last numeric path segment (Steam convention)
  const appIdMatch = installDir.match(/\\(\d+)$/);
  return {
    installDir,
    appId: appIdMatch?.[1],
  };
}

/**
 * Get tools whose manifest criteria match the given game context.
 *
 * Tools without criteria always pass (backward compatible).
 * Uses purely declarative matching — no hardcoded IDs.
 */
export async function getApplicableTools(
  game: GameContext,
): Promise<Map<ToolId, Tool>> {
  const applicable = new Map<ToolId, Tool>();

  for (const [toolId, tool] of _tools) {
    const registered = getRegisteredExtension(toolId);
    if (!registered) {
      // Tool without a registered extension — let it pass
      applicable.set(toolId, tool);
      continue;
    }

    const result = await evaluateManifestCriteria(registered.manifest, game);
    if (result.matched) {
      applicable.set(toolId, tool);
    }
  }

  return applicable;
}

/**
 * Detect which tools are applied to a specific game.
 *
 * First filters tools by manifest criteria (purely declarative),
 * then runs filesystem detection only on matching tools.
 * Tools without criteria always pass the filter.
 *
 * @param gameInstallDir - Absolute path to the game's install directory
 * @param gameContext - Optional additional game context for criteria evaluation
 */
export async function detectToolsForGame(
  gameInstallDir: string,
  gameContext?: GameContext,
): Promise<Map<ToolId, ToolDetectionResult>> {
  const results = new Map<ToolId, ToolDetectionResult>();
  const ctx = gameContext ?? gameContextFromInstallDir(gameInstallDir);

  const applicable = await getApplicableTools(ctx);

  for (const [toolId, tool] of applicable) {
    try {
      const result = await tool.detect(gameInstallDir);
      results.set(toolId, result);
    } catch (err) {
      results.set(toolId, {
        applied: false,
        fileStatus: {},
        message: `Detection failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return results;
}

// =============================================================================
// Apply / Revert
// =============================================================================

/**
 * Apply a tool to a game's install directory.
 *
 * @param toolId - The tool to apply
 * @param gameInstallDir - The game's install directory
 * @param extensionInstallDir - The directory containing the tool's source files
 * @param gameMeta - Metadata about the game for the applied fix record
 */
export async function applyTool(
  toolId: ToolId,
  gameInstallDir: string,
  extensionInstallDir: string,
  gameMeta: { gameId: string; appId?: string; gameTitle: string },
): Promise<ToolApplyResult> {
  const tool = _tools.get(toolId);
  if (!tool) {
    return { success: false, error: `Tool "${toolId}" not found.`, affectedFiles: [] };
  }

  const result = await tool.apply(gameInstallDir, extensionInstallDir);

  if (result.success && result.affectedFiles.length > 0) {
    const fix: AppliedFix = {
      toolId,
      toolName: tool.displayName,
      gameId: gameMeta.gameId,
      appId: gameMeta.appId,
      gameTitle: gameMeta.gameTitle,
      appliedAt: Date.now(),
      files: result.affectedFiles,
    };
    const key = `${toolId}:${gameMeta.gameId}`;
    _appliedFixes.set(key, fix);
    _persistAppliedFixes();
    _notify();

    showSuccess(`${tool.displayName} applied to ${gameMeta.gameTitle}`);
  } else if (!result.success) {
    showError(`Failed to apply ${tool.displayName}: ${result.error}`);
  }

  return result;
}

/**
 * Revert a tool from a game's install directory.
 */
export async function revertTool(
  toolId: ToolId,
  gameInstallDir: string,
  gameId: string,
): Promise<ToolApplyResult> {
  const tool = _tools.get(toolId);
  if (!tool) {
    return { success: false, error: `Tool "${toolId}" not found.`, affectedFiles: [] };
  }

  const result = await tool.revert(gameInstallDir);

  if (result.success) {
    const key = `${toolId}:${gameId}`;
    _appliedFixes.delete(key);
    _persistAppliedFixes();
    _notify();

    showSuccess(`${tool.displayName} reverted`);
  } else {
    showError(`Failed to revert ${tool.displayName}: ${result.error}`);
  }

  return result;
}

// =============================================================================
// Applied Fixes
// =============================================================================

/**
 * Get all applied fix records.
 */
export function getAppliedFixes(): AppliedFix[] {
  return Array.from(_appliedFixes.values()).sort(
    (a, b) => b.appliedAt - a.appliedAt,
  );
}

/**
 * Get applied fix records for a specific game.
 */
export function getAppliedFixesForGame(gameId: string): AppliedFix[] {
  return getAppliedFixes().filter((f) => f.gameId === gameId);
}

/**
 * Check if a specific tool is applied to a specific game.
 */
export function isToolApplied(toolId: ToolId, gameId: string): boolean {
  return _appliedFixes.has(`${toolId}:${gameId}`);
}

/**
 * Clear all applied fix records (for testing/reset).
 */
export function clearAppliedFixes(): void {
  _appliedFixes.clear();
  _persistAppliedFixes();
  _notify();
}

// =============================================================================
// Custom Handlers
// =============================================================================

/**
 * Registry of custom tool handlers.
 * Keyed by `customHandler` value from toolConfig.
 */
const _customHandlers = new Map<
  string,
  (manifest: ExtensionManifestV1, config: ReturnType<typeof extractToolConfig> & object) => Tool
>();

/**
 * Register a custom tool handler for a specific toolConfig.customHandler value.
 */
export function registerCustomToolHandler(
  handlerId: string,
  factory: (manifest: ExtensionManifestV1, config: ReturnType<typeof extractToolConfig> & object) => Tool,
): void {
  _customHandlers.set(handlerId, factory);
  // Re-discover after registering new handler
  if (_initialized) {
    discoverTools();
  }
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Directly register a tool into the registry (for testing only).
 * Bypasses extension discovery.
 */
export function registerToolForTest(tool: Tool): void {
  _tools.set(tool.id, tool);
  _notify();
}

/**
 * Unregister a tool from the registry (for testing only).
 */
export function unregisterToolForTest(toolId: ToolId): void {
  _tools.delete(toolId);
  _notify();
}

/**
 * Full reset for testing: clears tools, fixes, listeners, and initialized flag.
 */
export function resetToolManagerForTest(): void {
  _tools.clear();
  _listeners.clear();
  _appliedFixes.clear();
  _initialized = false;
  _customHandlers.clear();
}

// =============================================================================
// Debug
// =============================================================================

/**
 * Get a diagnostic summary of the ToolManager state.
 */
export function getToolManagerDiagnostics(): {
  toolCount: number;
  toolIds: string[];
  appliedFixCount: number;
  appliedFixes: Array<{ toolId: string; gameId: string; gameTitle: string }>;
} {
  return {
    toolCount: _tools.size,
    toolIds: Array.from(_tools.keys()),
    appliedFixCount: _appliedFixes.size,
    appliedFixes: Array.from(_appliedFixes.values()).map((f) => ({
      toolId: f.toolId,
      gameId: f.gameId,
      gameTitle: f.gameTitle,
    })),
  };
}
