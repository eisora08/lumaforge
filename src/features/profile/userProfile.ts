import { useState, useCallback, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

const DEBUG_PROFILE_SAVE = false;

export type UserProfile = {
  displayName: string;
  status: string;
  avatarPreset: string;
  avatarUrl?: string | null;
  avatarIsGif?: boolean;
  bannerPreset: string;
  bannerUrl?: string | null;
  bannerIsGif?: boolean;
  accentMode: "follow-theme" | "custom";
  accentColor?: string | null;
  updatedAt: number;
};

const STORAGE_KEY = "lumaforge-user-profile-v1";

export const DEFAULT_USER_PROFILE: UserProfile = {
  displayName: "Gamer",
  status: "Exploring the library",
  avatarPreset: "gamepad",
  avatarUrl: null,
  avatarIsGif: false,
  bannerPreset: "midnight",
  bannerUrl: null,
  bannerIsGif: false,
  accentMode: "follow-theme",
  accentColor: null,
  updatedAt: Date.now(),
};

function isStaleBlobUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("data:") || url.startsWith("blob:");
}

function migrateUrl(url: string | null | undefined): string | null | undefined {
  if (isStaleBlobUrl(url)) return null;
  return url ?? null;
}

function loadUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = { ...DEFAULT_USER_PROFILE, ...parsed, updatedAt: Date.now() };

      // Migrate stale blob/data URLs to null (use preset fallback instead)
      if (isStaleBlobUrl(merged.avatarUrl)) {
        merged.avatarUrl = null;
        merged.avatarIsGif = false;
      }
      if (isStaleBlobUrl(merged.bannerUrl)) {
        merged.bannerUrl = null;
        merged.bannerIsGif = false;
      }

      if (DEBUG_PROFILE_SAVE) console.log("[PROFILE][LOAD] source=localStorage", merged);
      return merged;
    }
  } catch {}
  return { ...DEFAULT_USER_PROFILE };
}

function persistUserProfile(profile: UserProfile): void {
  const cleaned = {
    ...profile,
    // Never persist stale blob/data URLs
    avatarUrl: migrateUrl(profile.avatarUrl),
    bannerUrl: migrateUrl(profile.bannerUrl),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    if (DEBUG_PROFILE_SAVE) {
      console.log("[PROFILE][SAVE]", {
        displayName: cleaned.displayName,
        hasAvatarUrl: !!cleaned.avatarUrl,
        hasBannerUrl: !!cleaned.bannerUrl,
        avatarIsGif: cleaned.avatarIsGif,
        bannerIsGif: cleaned.bannerIsGif,
        accentMode: cleaned.accentMode,
      });
    }
  } catch {}
}

export function getUserProfile(): UserProfile {
  return loadUserProfile();
}

export function saveUserProfile(profile: UserProfile): void {
  if (DEBUG_PROFILE_SAVE) console.log("[PROFILE][SAVE] direct call", profile.displayName);
  persistUserProfile(profile);
}

export function resetUserProfile(): UserProfile {
  if (DEBUG_PROFILE_SAVE) console.log("[PROFILE][RESET]");
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  return { ...DEFAULT_USER_PROFILE };
}

export function useUserProfile(): [UserProfile, (patch: Partial<UserProfile>) => void] {
  const [profile, setProfile] = useState<UserProfile>(loadUserProfile);

  useEffect(() => {
    persistUserProfile(profile);
  }, [profile]);

  const patchProfile = useCallback((patch: Partial<UserProfile>) => {
    setProfile((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }));
  }, []);

  // Listen for external restore writes and reload profile from localStorage
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === STORAGE_KEY) {
        setProfile(loadUserProfile());
      }
    };
    window.addEventListener("lumaforge-data-changed", handler);
    return () => window.removeEventListener("lumaforge-data-changed", handler);
  }, []);

  return [profile, patchProfile];
}

/**
 * Converts a profile media path to a displayable URL.
 * - null/undefined → null (preset fallback)
 * - data: URLs → null (stale, migrated away)
 * - http:// or https:// → returned as-is (GIPHY URLs)
 * - file paths → converted via convertFileSrc for Tauri asset protocol
 */
export function resolveProfileMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("data:") || url.startsWith("blob:")) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  // File path — convert to asset:// URL
  try {
    return convertFileSrc(url, "asset");
  } catch {
    return null;
  }
}
