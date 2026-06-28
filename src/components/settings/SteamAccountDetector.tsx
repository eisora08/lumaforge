import { useCallback, useState } from "react";
import { Crosshair, Users } from "lucide-react";
import { scanSteamLoginUsers } from "../../services/tauri";
import type { SteamLoginUser } from "../../types/steamLoginUser";

type Props = {
  steamRoot: string;
  currentSteamId64: string;
  onSelect: (steamId64: string) => void;
};

export default function SteamAccountDetector({ steamRoot, currentSteamId64, onSelect }: Props) {
  const [accounts, setAccounts] = useState<SteamLoginUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    if (!steamRoot) {
      setError("Steam Root path is required. Please set it in the Paths tab first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await scanSteamLoginUsers(steamRoot);
      setAccounts(result);
      if (result.length === 0) {
        setError("No saved Steam accounts found in loginusers.vdf.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [steamRoot]);

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 text-xs text-(--color-accent)">
        <Users className="h-3.5 w-3.5" />
        Tracked Steam Accounts
      </div>

      <button
        type="button"
        onClick={handleScan}
        disabled={loading}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
      >
        <Crosshair className="h-3.5 w-3.5" />
        {loading ? "Scanning..." : "Detect Steam accounts"}
      </button>

      {error && (
        <p className="text-[10px] text-red-400">{error}</p>
      )}

      {accounts && accounts.length > 0 && (
        <div className="space-y-1">
          {accounts.map((acc) => (
            <button
              key={acc.steamId}
              type="button"
              onClick={() => onSelect(acc.steamId)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                currentSteamId64 === acc.steamId
                  ? "bg-(--color-accent)/10 text-(--color-accent)"
                  : "text-(--color-text) hover:bg-white/5"
              }`}
            >
              <span className="flex-1 truncate">
                <span className="font-medium">{acc.personaName || acc.accountName}</span>
                <span className="ml-2 text-(--color-muted)">({acc.steamId})</span>
              </span>
              {currentSteamId64 === acc.steamId && (
                <span className="text-[9px] text-(--color-accent)">Active</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
