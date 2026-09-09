/**
 * ProfileEditor
 *
 * Edits an EmulatorProfileConfig with tabs:
 *   - General: name, type (builtin/custom), executable, arguments, platforms, file types, tracking
 *   - Scripts: pre/post/exit/startup scripts
 *   - Startup Script: script that replaces normal launch
 *
 * Matches Playnite's profile editor tabs.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Settings, Code, Terminal, FolderOpen, ChevronDown } from "lucide-react";
import type { EmulatorProfileConfig, TrackingMode } from "../../data/emulatorDefinitions/types";
import { emulatorDefinitions } from "../../data/emulatorDefinitions";
import { emulatorPlatforms } from "../../data/emulatorDefinitions/platforms";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { showError } from "../toast/GameToast";

type ProfileEditorProps = {
  profile: EmulatorProfileConfig;
  onChange: (profile: EmulatorProfileConfig) => void;
};

type ProfileTab = "general" | "scripts" | "startup";

const TRACKING_MODES: { value: TrackingMode; label: string }[] = [
  { value: "default", label: "Default (Emulator Default)" },
  { value: "process", label: "Process" },
  { value: "folder", label: "Folder" },
];

export function ProfileEditor({ profile, onChange }: ProfileEditorProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ProfileTab>("general");

  const update = useCallback(
    (updates: Partial<EmulatorProfileConfig>) => {
      onChange({ ...profile, ...updates });
    },
    [profile, onChange]
  );

  return (
    <div className="rounded border border-(--surface-active-border) bg-white/5 p-3 space-y-3">
      {/* Profile Type Badge */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
            profile.type === "builtin"
              ? "bg-blue-500/10 text-blue-400"
              : "bg-green-500/10 text-green-400"
          }`}
        >
          {profile.type === "builtin" ? t("emulator.builtin", "Built-in") : t("emulator.custom", "Custom")}
        </span>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-0 border-b border-(--surface-active-border)">
        <button
          onClick={() => setActiveTab("general")}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "general"
              ? "border-b-2 border-(--color-accent) text-(--color-accent)"
              : "text-(--color-muted) hover:text-(--color-text)"
          }`}
        >
          <Settings className="h-3 w-3" />
          {t("emulator.tab_general", "General")}
        </button>
        <button
          onClick={() => setActiveTab("scripts")}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "scripts"
              ? "border-b-2 border-(--color-accent) text-(--color-accent)"
              : "text-(--color-muted) hover:text-(--color-text)"
          }`}
        >
          <Code className="h-3 w-3" />
          {t("emulator.tab_scripts", "Scripts")}
        </button>
        <button
          onClick={() => setActiveTab("startup")}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "startup"
              ? "border-b-2 border-(--color-accent) text-(--color-accent)"
              : "text-(--color-muted) hover:text-(--color-text)"
          }`}
        >
          <Terminal className="h-3 w-3" />
          {t("emulator.tab_startup_script", "Startup Script")}
        </button>
      </div>

      {/* ── General Tab ── */}
      {activeTab === "general" && (
        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.profile_name", "Name")}
            </label>
            <input
              type="text"
              value={profile.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
            />
          </div>

          {/* Builtin Profile Selector */}
          {profile.type === "builtin" && (
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {t("emulator.builtin_profile", "Built-in Profile")}
              </label>
              <div className="relative">
                <select
                  value={profile.builtinProfileName ?? ""}
                  onChange={(e) => update({ builtinProfileName: e.target.value || undefined })}
                  className="w-full appearance-none rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 pr-8 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
                >
                  <option value="">—</option>
                  {emulatorDefinitions.map((def) =>
                    def.profiles.map((p) => (
                      <option key={`${def.id}:${p.name}`} value={p.name}>
                        {def.name} — {p.name}
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
              </div>
            </div>
          )}

          {/* Override Default Arguments (builtin only) */}
          {profile.type === "builtin" && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="overrideArgs"
                checked={profile.overrideDefaultArgs ?? false}
                onChange={(e) => update({ overrideDefaultArgs: e.target.checked })}
                className="rounded border-(--surface-active-border) bg-white/5 text-(--color-accent) focus:ring-(--color-accent)"
              />
              <label htmlFor="overrideArgs" className="text-xs text-(--color-muted)">
                {t("emulator.override_args", "Override default arguments")}
              </label>
            </div>
          )}

          {/* Custom Arguments */}
          {(profile.type === "custom" || profile.overrideDefaultArgs) && (
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {t("emulator.arguments", "Arguments")}
              </label>
              <input
                type="text"
                value={profile.arguments ?? profile.customArguments ?? ""}
                onChange={(e) =>
                  update(
                    profile.type === "builtin"
                      ? { customArguments: e.target.value }
                      : { arguments: e.target.value }
                  )
                }
                placeholder='"{ImagePath}" -f'
                className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none"
              />
              <p className="mt-0.5 text-[10px] text-(--color-muted)">
                {t("emulator.placeholders", "Placeholders: {ImagePath}, {ImageName}, {ImageNameNoExt}, {EmulatorDir}, {GameName}, {InstallDir}")}
              </p>
            </div>
          )}

          {/* Executable (custom only) */}
          {profile.type === "custom" && (
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {t("emulator.executable", "Executable")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={profile.executable ?? ""}
                  onChange={(e) => update({ executable: e.target.value })}
                  placeholder="C:\Emulators\my-emulator.exe"
                  className="flex-1 rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                />
                <button
                  onClick={async () => {
                    try {
                      const file = await openDialog({
                        title: t("emulator.select_exe", "Select Executable"),
                        filters: [{ name: "Executables", extensions: ["exe"] }],
                        defaultPath: profile.executable || "C:\\",
                        multiple: false,
                      });
                      if (file) update({ executable: file as string });
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      showError(t("emulator.file_picker_failed", "File picker failed: {{error}}", { error: msg }));
                    }
                  }}
                  className="rounded border border-(--surface-active-border) bg-white/5 px-2 py-1.5 text-(--color-text) hover:bg-white/10"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Working Directory (custom only) */}
          {profile.type === "custom" && (
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {t("emulator.working_dir", "Working Directory")}
              </label>
              <input
                type="text"
                value={profile.workingDirectory ?? ""}
                onChange={(e) => update({ workingDirectory: e.target.value })}
                placeholder="{EmulatorDir}"
                className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none"
              />
            </div>
          )}

          {/* Platforms */}
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.platforms", "Platforms")}
            </label>
            <div className="max-h-32 overflow-y-auto rounded border border-(--surface-active-border) bg-white/5 p-2 space-y-1">
              {emulatorPlatforms.map((p) => {
                const checked = profile.supportedPlatforms.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          update({ supportedPlatforms: [...profile.supportedPlatforms, p.id] });
                        } else {
                          update({ supportedPlatforms: profile.supportedPlatforms.filter((id) => id !== p.id) });
                        }
                      }}
                      className="rounded border-(--surface-active-border) bg-white/5 text-(--color-accent) focus:ring-(--color-accent)"
                    />
                    <span className="text-xs text-(--color-text)">{p.shortName}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* File Types */}
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.file_types", "File Types")}
            </label>
            <input
              type="text"
              value={profile.supportedFileTypes.join(", ")}
              onChange={(e) =>
                update({
                  supportedFileTypes: e.target.value
                    .split(",")
                    .map((s) => s.trim().replace(/^\./, ""))
                    .filter(Boolean),
                })
              }
              placeholder="sfc, smc, zip, 7z"
              className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none"
            />
          </div>

          {/* Tracking Mode */}
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.tracking_mode", "Tracking Mode")}
            </label>
            <div className="relative">
              <select
                value={profile.trackingMode}
                onChange={(e) => update({ trackingMode: e.target.value as TrackingMode })}
                className="w-full appearance-none rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 pr-8 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none"
              >
                {TRACKING_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
            </div>
          </div>

          {/* Tracking Path (for process/folder modes) */}
          {profile.trackingMode !== "default" && (
            <div>
              <label className="mb-1 block text-xs text-(--color-muted)">
                {profile.trackingMode === "process"
                  ? t("emulator.process_name", "Process Name")
                  : t("emulator.tracking_folder", "Tracking Folder")}
              </label>
              <input
                type="text"
                value={profile.trackingPath ?? ""}
                onChange={(e) => update({ trackingPath: e.target.value })}
                placeholder={profile.trackingMode === "process" ? "retroarch.exe" : "C:\\Games\\Saves"}
                className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Scripts Tab ── */}
      {activeTab === "scripts" && (
        <div className="space-y-3">
          {/* Pre Script */}
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.pre_script", "Pre-launch Script")}
            </label>
            <textarea
              value={profile.preScript ?? ""}
              onChange={(e) => update({ preScript: e.target.value || undefined })}
              placeholder="# Script to run before launching the emulator"
              rows={3}
              className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none font-mono"
            />
          </div>

          {/* Post Script */}
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.post_script", "Post-launch Script")}
            </label>
            <textarea
              value={profile.postScript ?? ""}
              onChange={(e) => update({ postScript: e.target.value || undefined })}
              placeholder="# Script to run after launching the emulator"
              rows={3}
              className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none font-mono"
            />
          </div>

          {/* Exit Script */}
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.exit_script", "Exit Script")}
            </label>
            <textarea
              value={profile.exitScript ?? ""}
              onChange={(e) => update({ exitScript: e.target.value || undefined })}
              placeholder="# Script to run after emulator exits"
              rows={3}
              className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none font-mono"
            />
          </div>
        </div>
      )}

      {/* ── Startup Script Tab ── */}
      {activeTab === "startup" && (
        <div className="space-y-3">
          <p className="text-xs text-(--color-muted)">
            {t("emulator.startup_script_hint", "A startup script replaces the normal launch command. When present, the emulator is started via this script instead of running the executable directly.")}
          </p>
          <div>
            <label className="mb-1 block text-xs text-(--color-muted)">
              {t("emulator.startup_script", "Startup Script")}
            </label>
            <textarea
              value={profile.startupScript ?? ""}
              onChange={(e) => update({ startupScript: e.target.value || undefined })}
              placeholder="# Custom startup script (replaces normal launch)"
              rows={8}
              className="w-full rounded border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-sm text-(--color-text) placeholder-(--color-muted) focus:border-(--color-accent) focus:outline-none font-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}
