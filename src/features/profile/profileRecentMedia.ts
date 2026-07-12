const STORAGE_KEY = "lumaforge-user-profile-media-recents-v1";
const MAX_AVATARS = 6;
const MAX_BANNERS = 6;

export type ProfileMediaEntry = {
  id: string;
  kind: "avatar" | "banner";
  source: "upload" | "gif" | "preset";
  url: string;
  isGif: boolean;
  label?: string;
  addedAt: number;
};

type RecentMediaStore = {
  avatars: ProfileMediaEntry[];
  banners: ProfileMediaEntry[];
};

function emptyStore(): RecentMediaStore {
  return { avatars: [], banners: [] };
}

function isStaleBlobUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

function loadStore(): RecentMediaStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const store = JSON.parse(raw) as RecentMediaStore;
      // Migrate: filter out stale data/blob URLs
      store.avatars = store.avatars.filter((e) => !isStaleBlobUrl(e.url));
      store.banners = store.banners.filter((e) => !isStaleBlobUrl(e.url));
      return store;
    }
  } catch {}
  return emptyStore();
}

function persistStore(store: RecentMediaStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addRecentMedia(entry: Omit<ProfileMediaEntry, "id" | "addedAt">): void {
  const store = loadStore();
  const list = entry.kind === "avatar" ? store.avatars : store.banners;
  const max = entry.kind === "avatar" ? MAX_AVATARS : MAX_BANNERS;

  const deduped = list.filter((e) => e.url !== entry.url);
  deduped.unshift({ ...entry, id: makeId(), addedAt: Date.now() });
  const trimmed = deduped.slice(0, max);

  if (entry.kind === "avatar") {
    store.avatars = trimmed;
  } else {
    store.banners = trimmed;
  }
  persistStore(store);
}

export function getRecentMedia(kind: "avatar" | "banner"): ProfileMediaEntry[] {
  const store = loadStore();
  return kind === "avatar" ? store.avatars : store.banners;
}

export function clearRecentMedia(kind?: "avatar" | "banner"): void {
  if (kind) {
    const store = loadStore();
    if (kind === "avatar") store.avatars = [];
    else store.banners = [];
    persistStore(store);
  } else {
    persistStore(emptyStore());
  }
}
