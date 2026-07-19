/**
 * OpenSteamTool Version — PE header version reading via Rust backend.
 *
 * Reads the version from the first managed DLL that has one.
 */

import { extensionGetDllVersion } from "../../services/extensionTauri";

const MANAGED_DLLS = ["dwmapi.dll", "xinput1_4.dll", "OpenSteamTool.dll"];

export async function getInstalledVersion(
  steamRoot: string
): Promise<string | null> {
  for (const dll of MANAGED_DLLS) {
    const version = await extensionGetDllVersion(steamRoot, dll);
    if (version) return version;
  }
  return null;
}
