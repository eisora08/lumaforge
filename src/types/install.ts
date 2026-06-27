export type InstallResult = {
  lua_installed: number;
  manifests_installed: number;
  backups_created: number;
  bytes_read: number;
  total_bytes: number;
  zip_path: string;
  message: string;
};