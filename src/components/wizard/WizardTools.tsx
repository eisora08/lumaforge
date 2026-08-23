import { Wrench, ExternalLink, Download } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../context/SettingsContext";
import WizardStep from "./WizardStep";

type Props = {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
  onSkip: () => void;
};

type ToolInfo = {
  id: string;
  name: string;
  description: string;
  github_owner: string;
  github_repo: string;
  installed: boolean;
  installed_version: string | null;
  latest_version: string | null;
  update_available: boolean;
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  smokeapi: "Steam API proxy — enables offline launch for Steam games. Hooks into steam_api.dll.",
  steamless: "DRM unpacker — removes SteamStub protection from game executables for offline use.",
  goldberg_fork: "Goldberg Steam Emu fork — emulates Steam API locally for offline multiplayer and achievements.",
  opensteamtool: "Open-source Steam unlocker with Lua scripting support. Installed to your Steam root directory.",
};

export default function WizardTools({ currentStep, totalSteps, onBack, onContinue, onSkip }: Props) {
  const { settings } = useSettings();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => {
    invoke<ToolInfo[]>("list_thirdparty_tools").then(setTools).catch(() => {});
  }, []);

  async function handleInstall(toolId: string) {
    setInstalling(toolId);
    try {
      await invoke("install_thirdparty_tool", {
        toolId,
        steamRoot: settings.steamRoot || undefined,
      });
      const updated = await invoke<ToolInfo[]>("list_thirdparty_tools");
      setTools(updated);
    } catch (err) {
      console.error(`Failed to install ${toolId}:`, err);
    } finally {
      setInstalling(null);
    }
  }

  return (
    <WizardStep
      icon={<Wrench className="h-8 w-8" />}
      title="Third-Party Tools"
      description="Optional tools for DRM handling and offline game support. Install what you need."
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={onBack}
      onContinue={onContinue}
      onSkip={onSkip}
    >
      {tools.map((tool) => {
        const description = TOOL_DESCRIPTIONS[tool.id] ?? tool.description;
        const isInstalling = installing === tool.id;

        return (
          <div
            key={tool.id}
            className={`rounded-2xl border p-4 transition ${
              tool.installed
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-white/[0.06] bg-white/[0.02]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-(--color-text)">{tool.name}</p>
                  {tool.installed && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                      Installed{tool.installed_version ? ` v${tool.installed_version}` : ""}
                    </span>
                  )}
                  {tool.update_available && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                      Update available
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-(--color-muted)">
                  {description}
                </p>
                <a
                  href={`https://github.com/${tool.github_owner}/${tool.github_repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-(--color-muted) transition hover:text-(--color-text)"
                >
                  <ExternalLink className="h-3 w-3" />
                  View on GitHub
                </a>
              </div>
              {!tool.installed && (
                <button
                  onClick={() => handleInstall(tool.id)}
                  disabled={isInstalling || !settings.steamRoot}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-(--color-accent) px-4 py-2 text-xs font-semibold text-(--color-accent-text) transition hover:brightness-110 disabled:opacity-40"
                >
                  {isInstalling ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {isInstalling ? "Installing…" : "Install"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {!settings.steamRoot && (
        <p className="text-center text-xs text-amber-400">
          Steam root path must be configured in Step 3 to install tools.
        </p>
      )}
    </WizardStep>
  );
}
