import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  CloudOff,
  HardDrive,
  Server,
  FolderOpen,
  Check,
  Loader2,
  RefreshCw,
  Download,
  Upload,
  ToggleLeft,
  ToggleRight,
  Key,
  Globe,
  AlertTriangle,
} from "lucide-react";
import {
  cloudGetStatus,
  cloudGetProviders,
  cloudDisconnect,
  cloudConnectLocal,
  cloudStartOAuth,
  cloudSetR2Credentials,
  cloudSetS3Credentials,
  cloudGetR2Credentials,
  cloudGetS3Credentials,
} from "../../services/cloudService";
import {
  listThirdPartyTools,
  installThirdPartyTool,
  updateThirdPartyTool,
  setThirdPartyToolEnabled,
} from "../../services/tauri";
import { useSettings } from "../../context/SettingsContext";
import type { CloudStatusResult, CloudProviderInfo, CloudR2Config, CloudS3Config } from "../../types/cloud";
import type { ThirdPartyToolInfo } from "../../services/tauri";

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  gdrive: <HardDrive className="h-5 w-5" />,
  onedrive: <Cloud className="h-5 w-5" />,
  s3: <Server className="h-5 w-5" />,
  r2: <Cloud className="h-5 w-5" />,
  folder: <FolderOpen className="h-5 w-5" />,
};

const DEFAULT_R2: CloudR2Config = {
  account_id: "",
  access_key_id: "",
  secret_access_key: "",
  bucket: "",
  key_prefix: "",
  endpoint: "",
};

const DEFAULT_S3: CloudS3Config = {
  access_key_id: "",
  secret_access_key: "",
  bucket: "",
  endpoint: "",
  region: "auto",
  key_prefix: "",
  sign_payload: false,
  allow_insecure_http: false,
  allow_insecure_tls: false,
  ca_cert_path: "",
};

export default function CloudSyncSection() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [status, setStatus] = useState<CloudStatusResult | null>(null);
  const [providers, setProviders] = useState<CloudProviderInfo[]>([]);
  const [crTool, setCrTool] = useState<ThirdPartyToolInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [localPath, setLocalPath] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [r2Config, setR2Config] = useState<CloudR2Config>(DEFAULT_R2);
  const [s3Config, setS3Config] = useState<CloudS3Config>(DEFAULT_S3);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [r2Saving, setR2Saving] = useState(false);
  const [s3Saving, setS3Saving] = useState(false);
  const [showRestartWarning, setShowRestartWarning] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [statusResult, providersResult, tools] = await Promise.all([
        cloudGetStatus(),
        cloudGetProviders(),
        listThirdPartyTools(),
      ]);
      setStatus(statusResult);
      setProviders(providersResult);
      setCrTool(tools.find((t) => t.id === "cloud_redirect") || null);

      // Load existing credentials
      const [r2Creds, s3Creds] = await Promise.all([
        cloudGetR2Credentials(),
        cloudGetS3Credentials(),
      ]);
      if (r2Creds) setR2Config(r2Creds);
      if (s3Creds) setS3Config(s3Creds);

      // Auto-select configured provider
      if (statusResult.provider) {
        setSelectedProvider(statusResult.provider);
      }
    } catch (err) {
      console.error("Failed to load cloud status:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleInstall() {
    setInstalling(true);
    try {
      const steamRoot = settings.steamRoot || undefined;
      await installThirdPartyTool("cloud_redirect", steamRoot);
      await loadData();
    } catch (err) {
      console.error("Failed to install CloudRedirect:", err);
    } finally {
      setInstalling(false);
    }
  }

  async function handleUpdate() {
    setInstalling(true);
    try {
      const steamRoot = settings.steamRoot || undefined;
      await updateThirdPartyTool("cloud_redirect", steamRoot);
      await loadData();
    } catch (err) {
      console.error("Failed to update CloudRedirect:", err);
    } finally {
      setInstalling(false);
    }
  }

  async function handleToggleEnabled() {
    if (!crTool) return;
    setInstalling(true);
    try {
      const steamRoot = settings.steamRoot || undefined;
      await setThirdPartyToolEnabled("cloud_redirect", !crTool.enabled, steamRoot);
      await loadData();
    } catch (err) {
      console.error("Failed to toggle CloudRedirect:", err);
    } finally {
      setInstalling(false);
    }
  }

  async function handleConnectLocal() {
    if (!localPath.trim()) return;
    setConnecting("folder");
    try {
      const result = await cloudConnectLocal(localPath);
      setStatus(result);
      setSelectedProvider("folder");
    } catch (err) {
      console.error("Failed to connect local:", err);
    } finally {
      setConnecting(null);
    }
  }

  async function handleOAuth(providerId: string) {
    setOauthLoading(providerId);
    setShowRestartWarning(false);
    try {
      const result = await cloudStartOAuth(providerId);
      if (result.success) {
        await loadData();
        setSelectedProvider(providerId);
        setShowRestartWarning(true);
      }
    } catch (err) {
      console.error(`OAuth failed for ${providerId}:`, err);
    } finally {
      setOauthLoading(null);
    }
  }

  async function handleSaveR2() {
    setR2Saving(true);
    try {
      const result = await cloudSetR2Credentials(r2Config);
      setStatus(result);
      setSelectedProvider("r2");
    } catch (err) {
      console.error("Failed to save R2 credentials:", err);
    } finally {
      setR2Saving(false);
    }
  }

  async function handleSaveS3() {
    setS3Saving(true);
    try {
      const result = await cloudSetS3Credentials(s3Config);
      setStatus(result);
      setSelectedProvider("s3");
    } catch (err) {
      console.error("Failed to save S3 credentials:", err);
    } finally {
      setS3Saving(false);
    }
  }

  async function handleDisconnect() {
    try {
      const result = await cloudDisconnect();
      setStatus(result);
      setSelectedProvider(null);
    } catch (err) {
      console.error("Failed to disconnect:", err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-(--color-muted)">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("settings.cloud_loading", "Loading...")}
      </div>
    );
  }

  const dllInstalled = status?.dll_installed ?? false;

  return (
    <div className="space-y-4">
      {/* CloudRedirect DLL status + install/update */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {dllInstalled ? (
            <>
              <Check className="h-4 w-4 text-green-500" />
              <span className="text-green-500">
                {t("settings.cloud_dll_installed", "CloudRedirect installed")}
                {crTool?.installedVersion && ` v${crTool.installedVersion}`}
              </span>
            </>
          ) : (
            <>
              <CloudOff className="h-4 w-4 text-yellow-500" />
              <span className="text-yellow-500">
                {t("settings.cloud_dll_missing", "CloudRedirect not installed")}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!dllInstalled ? (
            <button
              onClick={handleInstall}
              disabled={installing}
              className="flex items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {installing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {t("settings.cloud_install", "Install")}
            </button>
          ) : (
            <>
              {crTool?.updateAvailable && (
                <button
                  onClick={handleUpdate}
                  disabled={installing}
                  className="flex items-center gap-1.5 rounded-lg border border-(--color-accent)/30 px-3 py-1.5 text-xs font-medium text-(--color-accent) hover:bg-(--color-accent)/10 disabled:opacity-50"
                >
                  {installing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {t("settings.cloud_update", "Update")}
                  {crTool?.latestVersion && ` v${crTool.latestVersion}`}
                </button>
              )}
              <button
                onClick={handleToggleEnabled}
                disabled={installing}
                className="flex items-center gap-1.5 rounded-lg border border-(--color-border) px-3 py-1.5 text-xs font-medium text-(--color-text) hover:bg-(--color-surface) disabled:opacity-50"
              >
                {crTool?.enabled ? (
                  <ToggleRight className="h-3 w-3 text-green-500" />
                ) : (
                  <ToggleLeft className="h-3 w-3 text-(--color-muted)" />
                )}
                {crTool?.enabled
                  ? t("settings.cloud_enabled", "Enabled")
                  : t("settings.cloud_disabled", "Disabled")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Restart Steam warning */}
      {showRestartWarning && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-500">
              {t("settings.cloud_restart_steam_title", "Restart Steam required")}
            </p>
            <p className="text-xs text-(--color-muted) mt-1">
              {t("settings.cloud_restart_steam", "Restart Steam for Cloud Redirect to start syncing saves.")}
            </p>
          </div>
          <button
            onClick={() => setShowRestartWarning(false)}
            className="ml-auto shrink-0 text-xs text-(--color-muted) hover:text-(--color-text)"
          >
            &times;
          </button>
        </div>
      )}

      {/* Provider selection cards */}
      {dllInstalled && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {providers.map((provider) => {
            const isSelected = selectedProvider === provider.id;
            const isConfigured = provider.configured;
            return (
              <button
                key={provider.id}
                onClick={() => setSelectedProvider(isSelected && isConfigured ? null : provider.id)}
                disabled={connecting !== null || oauthLoading !== null}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  isConfigured
                    ? "border-green-500/50 bg-green-500/10"
                    : isSelected
                      ? "border-(--color-accent) bg-(--color-accent)/10"
                      : "border-(--color-border) hover:border-(--color-accent) hover:bg-(--color-accent)/5"
                }`}
              >
                <div className="text-(--color-muted)">
                  {PROVIDER_ICONS[provider.id] || <Cloud className="h-5 w-5" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-(--color-text)">
                    {provider.name}
                  </div>
                  {isConfigured && (
                    <div className="text-xs text-green-500">
                      {t("settings.cloud_active", "Active")}
                    </div>
                  )}
                </div>
                {(connecting === provider.id || oauthLoading === provider.id) && (
                  <Loader2 className="h-4 w-4 animate-spin text-(--color-accent)" />
                )}
                {isConfigured && connecting === null && oauthLoading === null && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Provider-specific forms */}
      {dllInstalled && selectedProvider && (
        <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 space-y-4">
          {/* Google Drive / OneDrive OAuth */}
          {(selectedProvider === "gdrive" || selectedProvider === "onedrive") && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                {selectedProvider === "gdrive" ? (
                  <HardDrive className="h-4 w-4" />
                ) : (
                  <Cloud className="h-4 w-4" />
                )}
                {selectedProvider === "gdrive" ? "Google Drive" : "OneDrive"}
              </div>
              {status?.configured && status?.provider === selectedProvider ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-green-500">
                    <Check className="h-4 w-4" />
                    {t("settings.cloud_connected", "Connected")}
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="text-xs text-red-500 hover:text-red-400"
                  >
                    {t("settings.cloud_disconnect", "Disconnect")}
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-(--color-muted)">
                    {t("settings.cloud_oauth_desc", "Sign in with your account to sync saves to your cloud storage.")}
                  </p>
                  <button
                    onClick={() => handleOAuth(selectedProvider)}
                    disabled={oauthLoading !== null}
                    className="flex items-center gap-2 rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {oauthLoading === selectedProvider ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Globe className="h-4 w-4" />
                    )}
                    {selectedProvider === "gdrive"
                      ? t("settings.cloud_gdrive_signin", "Sign in with Google")
                      : t("settings.cloud_onedrive_signin", "Sign in with Microsoft")}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Cloudflare R2 */}
          {selectedProvider === "r2" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                <Cloud className="h-4 w-4" />
                {t("settings.cloud_r2_title", "Cloudflare R2")}
              </div>
              <p className="text-xs text-(--color-muted)">
                {t("settings.cloud_r2_desc", "Recommended. Fast, cheap ($0.015/GB/mo), no egress fees.")}
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_r2_account_id", "Account ID")}
                  </label>
                  <input
                    type="text"
                    value={r2Config.account_id}
                    onChange={(e) => setR2Config({ ...r2Config, account_id: e.target.value })}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_r2_bucket", "Bucket")}
                  </label>
                  <input
                    type="text"
                    value={r2Config.bucket}
                    onChange={(e) => setR2Config({ ...r2Config, bucket: e.target.value })}
                    placeholder="my-cloud-saves"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-(--color-muted)">
                  {t("settings.cloud_r2_access_key", "Access Key ID")}
                </label>
                <input
                  type="text"
                  value={r2Config.access_key_id}
                  onChange={(e) => setR2Config({ ...r2Config, access_key_id: e.target.value })}
                  placeholder="Access Key ID"
                  className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-(--color-muted)">
                  {t("settings.cloud_r2_secret_key", "Secret Access Key")}
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
                  <input
                    type="password"
                    value={r2Config.secret_access_key}
                    onChange={(e) => setR2Config({ ...r2Config, secret_access_key: e.target.value })}
                    placeholder="Secret Access Key"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) pl-9 pr-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_r2_key_prefix", "Key Prefix (optional)")}
                  </label>
                  <input
                    type="text"
                    value={r2Config.key_prefix || ""}
                    onChange={(e) => setR2Config({ ...r2Config, key_prefix: e.target.value })}
                    placeholder="steam/"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_r2_endpoint", "Endpoint (optional)")}
                  </label>
                  <input
                    type="text"
                    value={r2Config.endpoint || ""}
                    onChange={(e) => setR2Config({ ...r2Config, endpoint: e.target.value })}
                    placeholder="https://ACCOUNT_ID.r2.cloudflarestorage.com"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
              </div>

              <button
                onClick={handleSaveR2}
                disabled={r2Saving || !r2Config.account_id || !r2Config.access_key_id || !r2Config.secret_access_key || !r2Config.bucket}
                className="flex items-center gap-2 rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {r2Saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t("settings.cloud_r2_save", "Save Credentials")}
              </button>
            </div>
          )}

          {/* S3 Compatible */}
          {selectedProvider === "s3" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                <Server className="h-4 w-4" />
                {t("settings.cloud_s3_title", "S3 Compatible Storage")}
              </div>
              <p className="text-xs text-(--color-muted)">
                {t("settings.cloud_s3_desc", "Use any S3-compatible storage (AWS, Backblaze B2, MinIO, etc.)")}
              </p>

              <div>
                <label className="mb-1 block text-xs text-(--color-muted)">
                  {t("settings.cloud_s3_endpoint", "Endpoint URL")}
                </label>
                <input
                  type="text"
                  value={s3Config.endpoint}
                  onChange={(e) => setS3Config({ ...s3Config, endpoint: e.target.value })}
                  placeholder="https://s3.amazonaws.com"
                  className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_s3_access_key", "Access Key ID")}
                  </label>
                  <input
                    type="text"
                    value={s3Config.access_key_id}
                    onChange={(e) => setS3Config({ ...s3Config, access_key_id: e.target.value })}
                    placeholder="Access Key ID"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_s3_secret_key", "Secret Access Key")}
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted)" />
                    <input
                      type="password"
                      value={s3Config.secret_access_key}
                      onChange={(e) => setS3Config({ ...s3Config, secret_access_key: e.target.value })}
                      placeholder="Secret Access Key"
                      className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) pl-9 pr-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_s3_bucket", "Bucket")}
                  </label>
                  <input
                    type="text"
                    value={s3Config.bucket}
                    onChange={(e) => setS3Config({ ...s3Config, bucket: e.target.value })}
                    placeholder="my-cloud-saves"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--color-muted)">
                    {t("settings.cloud_s3_region", "Region")}
                  </label>
                  <input
                    type="text"
                    value={s3Config.region}
                    onChange={(e) => setS3Config({ ...s3Config, region: e.target.value })}
                    placeholder="us-east-1"
                    className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-(--color-muted)">
                  {t("settings.cloud_s3_key_prefix", "Key Prefix (optional)")}
                </label>
                <input
                  type="text"
                  value={s3Config.key_prefix || ""}
                  onChange={(e) => setS3Config({ ...s3Config, key_prefix: e.target.value })}
                  placeholder="steam/"
                  className="w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-4 text-xs text-(--color-muted)">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={s3Config.sign_payload || false}
                    onChange={(e) => setS3Config({ ...s3Config, sign_payload: e.target.checked })}
                    className="rounded border-(--color-border)"
                  />
                  {t("settings.cloud_s3_sign_payload", "Sign payloads")}
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={s3Config.allow_insecure_http || false}
                    onChange={(e) => setS3Config({ ...s3Config, allow_insecure_http: e.target.checked })}
                    className="rounded border-(--color-border)"
                  />
                  {t("settings.cloud_s3_insecure_http", "Allow HTTP")}
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={s3Config.allow_insecure_tls || false}
                    onChange={(e) => setS3Config({ ...s3Config, allow_insecure_tls: e.target.checked })}
                    className="rounded border-(--color-border)"
                  />
                  {t("settings.cloud_s3_insecure_tls", "Skip TLS verify")}
                </label>
              </div>

              <button
                onClick={handleSaveS3}
                disabled={s3Saving || !s3Config.access_key_id || !s3Config.secret_access_key || !s3Config.bucket || !s3Config.endpoint}
                className="flex items-center gap-2 rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {s3Saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t("settings.cloud_s3_save", "Save Credentials")}
              </button>
            </div>
          )}

          {/* Local Folder */}
          {selectedProvider === "folder" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-(--color-text)">
                <FolderOpen className="h-4 w-4" />
                {t("settings.cloud_local_title", "Local Folder")}
              </div>
              <p className="text-xs text-(--color-muted)">
                {t("settings.cloud_local_desc", "Sync saves to a local folder (useful for network drives or external storage).")}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder={t("settings.cloud_local_path_placeholder", "D:\\CloudSaves")}
                  className="flex-1 rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-muted) focus:border-(--color-accent) focus:outline-none"
                />
                <button
                  onClick={handleConnectLocal}
                  disabled={!localPath.trim() || connecting !== null}
                  className="flex items-center gap-2 rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {connecting === "folder" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4" />
                  )}
                  {t("settings.cloud_local_set", "Set Path")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Refresh button */}
      <button
        onClick={loadData}
        className="flex items-center gap-2 text-sm text-(--color-muted) hover:text-(--color-text)"
      >
        <RefreshCw className="h-4 w-4" />
        {t("settings.cloud_refresh", "Refresh")}
      </button>
    </div>
  );
}
