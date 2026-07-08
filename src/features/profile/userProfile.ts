import { useState, useCallback, useEffect } from "react";

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

function loadUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = { ...DEFAULT_USER_PROFILE, ...parsed, updatedAt: Date.now() };
      if (DEBUG_PROFILE_SAVE) console.log("[PROFILE][LOAD] source=localStorage", merged);
      return merged;
    }
  } catch {}
  return { ...DEFAULT_USER_PROFILE };
}

function persistUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    if (DEBUG_PROFILE_SAVE) {
      console.log("[PROFILE][SAVE]", {
        displayName: profile.displayName,
        hasAvatarUrl: !!profile.avatarUrl,
        hasBannerUrl: !!profile.bannerUrl,
        avatarIsGif: profile.avatarIsGif,
        bannerIsGif: profile.bannerIsGif,
        accentMode: profile.accentMode,
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

  return [profile, patchProfile];
}
