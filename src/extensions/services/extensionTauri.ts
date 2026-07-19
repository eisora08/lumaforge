import { invoke } from "@tauri-apps/api/core";

export interface ExtensionFileStatus {
  exists: boolean;
  size: number | null;
  modifiedAt: number | null;
}

export async function extensionFileExists(path: string): Promise<boolean> {
  return await invoke<boolean>("extension_file_exists", { path });
}

export async function extensionFileStatus(path: string): Promise<ExtensionFileStatus> {
  return await invoke<ExtensionFileStatus>("extension_file_status", { path });
}

export async function extensionRenameFile(
  from: string,
  to: string
): Promise<void> {
  return await invoke("extension_rename_file", { from, to });
}

export async function extensionBatchRename(
  renames: Array<[string, string]>
): Promise<string[]> {
  return await invoke<string[]>("extension_batch_rename", { renames });
}

export async function extensionGetDllVersion(
  steamRoot: string,
  fileName: string
): Promise<string | null> {
  return await invoke<string | null>("extension_get_dll_version", {
    steamRoot,
    fileName,
  });
}

export async function extensionRemoveFile(path: string): Promise<boolean> {
  return await invoke<boolean>("extension_remove_file", { path });
}

export async function extensionCreateDir(path: string): Promise<boolean> {
  return await invoke<boolean>("extension_create_dir", { path });
}

export async function extensionListDirectory(path: string): Promise<string[]> {
  return await invoke<string[]>("extension_list_directory", { path });
}

export async function extensionDownloadFile(
  url: string,
  targetPath: string
): Promise<void> {
  return await invoke("extension_download_file", { url, targetPath });
}

export async function extensionExtractZip(
  zipPath: string,
  targetDir: string,
  expectedFiles: string[]
): Promise<string[]> {
  return await invoke<string[]>("extension_extract_zip", {
    zipPath,
    targetDir,
    expectedFiles,
  });
}
