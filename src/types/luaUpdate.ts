export type LuaUpdateStatus =
  | "updated"
  | "update-available"
  | "provider-available"
  | "provider-unavailable"
  | "checking"
  | "unknown"
  | "disabled";

export type LuaUpdateInfo = {
  status: LuaUpdateStatus;
  label: string;
  description: string;
  providerName?: string;
  lastCheckedAt?: string;
};