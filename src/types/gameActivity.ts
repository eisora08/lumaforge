export type GameActivityKind =
  | "game-detected"
  | "game-installed"
  | "game-launched"
  | "lua-installed"
  | "lua-synced"
  | "lua-updated"
  | "lua-disabled"
  | "lua-enabled"
  | "source-selected"
  | "metadata-refreshed"
  | "artwork-refreshed"
  | "dlc-detected"
  | "local-file-change";

export type GameActivityItem = {
  id: string;
  gameId: string;
  appId?: string;
  kind: GameActivityKind;
  title: string;
  description?: string;
  createdAt: number;
  source: "local" | "steam" | "lua" | "provider" | "system";
  severity?: "info" | "success" | "warning" | "error";
};

export type GameUpdateItem = {
  id: string;
  gameId: string;
  appId?: string;
  title: string;
  description?: string;
  createdAt: number;
  kind: "sync" | "metadata" | "dlc" | "provider" | "local";
  status?: "available" | "completed" | "failed" | "info";
};

export type SteamNewsItem = {
  gid: string;
  title: string;
  url: string;
  isExternalUrl: boolean;
  author: string;
  contents: string;
  summary: string;
  feedLabel: string;
  date: number;
  feedName: string;
  category: string;
  appId: string;
  thumbnail?: string;
};
