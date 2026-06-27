
export type LuaUpdateStatus =
  | "updated"
  | "update-available"
  | "unknown"
  | "disabled";

export type LuaUpdateInfo = {
  status: LuaUpdateStatus;
  label: string;
  description: string;
};
