export type OwnedSteamGame = {
  appid: number;
  name: string | null;
  playtime_forever: number | null;
  playtime_windows_forever: number | null;
  playtime_mac_forever: number | null;
  playtime_linux_forever: number | null;
  has_community_visible_stats: boolean | null;
  last_played: number | null;
  img_logo_url: string | null;
  img_icon_url: string | null;
};
