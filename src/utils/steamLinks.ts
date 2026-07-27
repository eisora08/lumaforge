export function getSteamStoreUrl(appId: number) {
  return `https://store.steampowered.com/app/${appId}`;
}

export function getSteamCommunityUrl(appId: number) {
  return `https://steamcommunity.com/app/${appId}`;
}

export function getSteamDiscussionsUrl(appId: number) {
  return `https://steamcommunity.com/app/${appId}/discussions/`;
}

export function getSteamGuidesUrl(appId: number) {
  return `https://steamcommunity.com/app/${appId}/guides/`;
}

export function getSteamSupportUrl(appId: number) {
  return `https://help.steampowered.com/en/wizard/HelpWithGame/?appid=${appId}`;
}

export function getSteamDbUrl(appId: number) {
  return `https://steamdb.info/app/${appId}`;
}

export function getSteamUninstallUrl(appId: number) {
  return `steam://uninstall/${appId}`;
}

export function getSteamStoreProtocolUrl(appId: number) {
  return `steam://store/${appId}`;
}
