import { PackageGame } from "../types/package";

export const mockPackages: PackageGame[] = [
  {
    appId: "1245620",
    title: "Elden Ring",
    developer: "FromSoftware",
    imageUrl:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg",
    platforms: ["Windows"],
    sources: [
      {
        providerId: "hubcapdb",
        providerName: "HubcapDB",
        fileType: "zip",
        available: true,
        lastUpdated: "2 hours ago",
      },
      {
        providerId: "ryuu",
        providerName: "Ryuu",
        fileType: "lua",
        available: true,
        lastUpdated: "1 day ago",
      },
    ],
  },
  {
    appId: "413150",
    title: "Stardew Valley",
    developer: "ConcernedApe",
    imageUrl:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/413150/header.jpg",
    platforms: ["Windows", "macOS", "Linux"],
    sources: [
      {
        providerId: "ryuu",
        providerName: "Ryuu",
        fileType: "zip",
        available: true,
        lastUpdated: "5 hours ago",
      },
      {
        providerId: "sushi",
        providerName: "Sushi",
        fileType: "zip",
        available: false,
        error: "Not found",
      },
    ],
  },
  {
    appId: "1091500",
    title: "Cyberpunk 2077",
    developer: "CD PROJEKT RED",
    imageUrl:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg",
    platforms: ["Windows"],
    sources: [
      {
        providerId: "hubcapdb",
        providerName: "HubcapDB",
        fileType: "manifest",
        available: true,
        lastUpdated: "30 minutes ago",
      },
      {
        providerId: "twentytwo-cloud",
        providerName: "TwentyTwo Cloud",
        fileType: "zip",
        available: true,
        lastUpdated: "3 hours ago",
      },
    ],
  },
  {
    appId: "730",
    title: "Counter-Strike 2",
    developer: "Valve",
    imageUrl:
      "https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg",
    platforms: ["Windows", "Linux"],
    sources: [
      {
        providerId: "custom",
        providerName: "Custom API",
        fileType: "lua",
        available: false,
        error: "Provider disabled",
      },
    ],
  },
];