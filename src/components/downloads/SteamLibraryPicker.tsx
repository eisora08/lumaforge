import { useState, useEffect } from "react";
import { HardDrive, Loader2, Plus, RefreshCw } from "lucide-react";

import {
  steamLibraryDetect,
  SteamLibraryInfo as SteamLibraryInfoType,
} from "../../services/tauri";

interface SteamLibraryPickerProps {
  selectedPath: string | null;
  onSelect: (path: string) => void;
  hideOnNonLinux?: boolean;
}

export default function SteamLibraryPicker({
  selectedPath,
  onSelect,
  hideOnNonLinux = true,
}: SteamLibraryPickerProps) {
  const [libraries, setLibraries] = useState<SteamLibraryInfoType[]>([]);
  const [loading, setLoading] = useState(true);
  const [customPath, setCustomPath] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const isLinux = navigator.platform.toLowerCase().includes("linux");

  const detect = async () => {
    setLoading(true);
    try {
      const libs = await steamLibraryDetect();
      setLibraries(libs);
      // Auto-select primary if nothing selected
      if (!selectedPath && libs.length > 0) {
        const primary = libs.find((l) => l.is_primary) || libs[0];
        onSelect(primary.path);
      }
    } catch (err) {
      console.warn("[SteamLibrary] Failed to detect:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLinux || !hideOnNonLinux) {
      detect();
    }
  }, []);

  if (hideOnNonLinux && !isLinux) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-neutral-800/50 text-neutral-400 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Detecting Steam libraries...</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-700/50 bg-neutral-800/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-neutral-400" />
          <span className="text-sm font-medium text-neutral-200">Steam Library</span>
        </div>
        <button
          onClick={detect}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {libraries.length === 0 ? (
        <div className="text-xs text-neutral-500">
          No Steam libraries found.{" "}
          <button
            onClick={() => setShowCustom(true)}
            className="text-blue-400 hover:text-blue-300"
          >
            Add manually
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {libraries.map((lib) => (
            <label
              key={lib.path}
              className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                selectedPath === lib.path
                  ? "bg-blue-600/20 border border-blue-500/50"
                  : "bg-neutral-800/50 border border-transparent hover:border-neutral-600/50"
              }`}
            >
              <input
                type="radio"
                name="steam-library"
                value={lib.path}
                checked={selectedPath === lib.path}
                onChange={() => onSelect(lib.path)}
                className="sr-only"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-200 truncate">{lib.path}</span>
                  {lib.is_primary && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">
                      Primary
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {lib.has_steamapps ? "steamapps found" : "steamapps missing"}
                  {lib.disk_space_available > 0 && (
                    <span>
                      {" "}
                      &middot;{" "}
                      {(lib.disk_space_available / (1024 * 1024 * 1024)).toFixed(1)} GB
                      available
                    </span>
                  )}
                </div>
              </div>
              <div
                className={`w-3 h-3 rounded-full border-2 ${
                  selectedPath === lib.path
                    ? "border-blue-500 bg-blue-500"
                    : "border-neutral-600"
                }`}
              />
            </label>
          ))}
        </div>
      )}

      {showCustom && (
        <div className="flex gap-2">
          <input
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/path/to/steam"
            className="flex-1 px-3 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              if (customPath.trim()) {
                onSelect(customPath.trim());
                setShowCustom(false);
                setCustomPath("");
              }
            }}
            className="px-3 py-1.5 rounded-md bg-blue-600/20 text-blue-400 text-xs hover:bg-blue-600/30 transition-colors"
          >
            Add
          </button>
        </div>
      )}

      {!showCustom && (
        <button
          onClick={() => setShowCustom(true)}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add custom path
        </button>
      )}
    </div>
  );
}
