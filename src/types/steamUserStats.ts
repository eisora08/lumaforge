export type SteamUserGameStats = {
  appId: number;
  steamId?: string;
  lastPlayed?: number;
  playtimeMinutes?: number;
  playtime2Weeks?: number;
  cloudStatus?: string;
  autocloudLastLaunch?: number;
  autocloudLastExit?: number;
};
