import { useState, useCallback, useEffect } from "react";

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
      return { ...DEFAULT_USER_PROFILE, ...parsed, updatedAt: Date.now() };
    }
  } catch {}
  return { ...DEFAULT_USER_PROFILE };
}

function persistUserProfile(profile: UserProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {}
}

export function getUserProfile(): UserProfile {
  return loadUserProfile();
}

export function saveUserProfile(profile: UserProfile): void {
  persistUserProfile(profile);
}

export function resetUserProfile(): UserProfile {
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
