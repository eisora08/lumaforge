/**
 * EpicAuthPanel — Connect/disconnect Epic Games account.
 *
 * Uses WebView-based OAuth flow: opens a new window for Epic login,
 * intercepts the redirect automatically, exchanges code for tokens.
 */

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";

import {
  epicIsLoggedIn,
  epicGetAccountInfo,
  epicLogout,
  epicStartAuthFlow,
} from "../../services/tauri";
import { EPIC_AUTH_ENABLED } from "../../services/epicFeatureFlag";

type EpicAccountInfo = {
  id: string;
  displayName?: string;
};

export function EpicAuthPanel() {
  const { t } = useTranslation();

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [accountInfo, setAccountInfo] = useState<EpicAccountInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authInProgress, setAuthInProgress] = useState(false);

  // Check login status on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loggedIn = await epicIsLoggedIn();
        if (cancelled) return;
        setIsLoggedIn(loggedIn);
        if (loggedIn) {
          try {
            const info = await epicGetAccountInfo();
            if (!cancelled) setAccountInfo(info);
          } catch (err) {
            console.error("[EPIC_AUTH] epicGetAccountInfo failed on mount:", err);
          }
        }
      } catch (err) {
        console.error("[EPIC_AUTH] epicIsLoggedIn failed on mount:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Listen for auth completion event
  useEffect(() => {
    const unlisten = listen<{
      success: boolean;
      tokens?: { account_id?: string; access_token?: string; display_name?: string };
      error?: string;
    }>("epic-auth-complete", async (event) => {
      setAuthInProgress(false);
      setIsLoading(false);

      if (event.payload.success) {
        setIsLoggedIn(true);
        try {
          const info = await epicGetAccountInfo();
          setAccountInfo(info);
        } catch (err) {
          console.error("[EPIC_AUTH] epicGetAccountInfo failed, using token fallback:", err);
          // Fallback: construct info from the token payload
          if (event.payload.tokens?.account_id) {
            setAccountInfo({
              id: event.payload.tokens.account_id,
              displayName: event.payload.tokens.display_name,
            });
          }
        }
        // Trigger library import after successful login (fire-and-forget)
        try {
          const { refreshOwnedGames } = await import("../../services/epicGameStore");
          refreshOwnedGames().catch((err: unknown) => console.warn("[EPIC_AUTH] refreshOwnedGames failed:", err));
        } catch (err) {
          console.warn("[EPIC_AUTH] Failed to import refreshOwnedGames:", err);
        }
      } else {
        setError(event.payload.error || "Authentication failed");
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    setAuthInProgress(true);
    try {
      await epicStartAuthFlow();
      // The window is now open. We wait for the epic-auth-complete event.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsLoading(false);
      setAuthInProgress(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      await epicLogout();
      setIsLoggedIn(false);
      setAccountInfo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check if Epic auth is enabled
  if (!EPIC_AUTH_ENABLED) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
        <p className="text-sm text-slate-400">
          {t("epic.auth_disabled")}
        </p>
      </div>
    );
  }

  // ── Logged in state ──
  if (isLoggedIn && accountInfo) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
              <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-300">
                {t("epic.connected")}
              </p>
              <p className="text-xs text-slate-400">
                {accountInfo.displayName || accountInfo.id}
              </p>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={isLoading}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200 disabled:opacity-50"
          >
            {t("epic.disconnect")}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
      </div>
    );
  }

  // ── Auth in progress ──
  if (authInProgress) {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <p className="text-sm text-cyan-300">
            {t("epic.auth_window_open")}
          </p>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
      </div>
    );
  }

  // ── Not logged in state ──
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/30 p-4">
      <p className="mb-3 text-sm text-slate-400">
        {t("epic.connect_description")}
      </p>
      <button
        onClick={handleConnect}
        disabled={isLoading}
        className="rounded-md bg-[#2a2a2a] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3a3a3a] disabled:opacity-50"
      >
        {isLoading
          ? t("epic.connecting")
          : t("epic.connect_button")}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
