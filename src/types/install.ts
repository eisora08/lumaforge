export type InstallResult = {
  lua_installed: number;
  manifests_installed: number;
  backups_created: number;
  message: string;
};