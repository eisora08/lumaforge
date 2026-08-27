import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  X,
  Save,
  Image,
  Type,
  FileImage,
  Monitor,
  PanelTop,
  Layers,
  Camera,
  Palette,
  FolderOpen,
  Copy,
  RefreshCw,
  Code,
  HardDrive,
  Info,
  Globe,
  ChevronDown,
  ExternalLink,
  Video,
  Search,
} from "lucide-react";
import type { GameMediaPaths, GameAppInfo } from "../../services/tauri";
import type { LibraryGame } from "../../types/libraryGame";
import { getGameAppInfo, resolveSteamGridDbArtwork, searchSteamGridDbGames, resolveSteamGridDbArtworkByGameId, openGameMetadataFolder, openGameMediaFolder, openFolder, resolveSteamStoreSearch, openProviderMediaFolder, pickFile, pickFolder, calculateDirectorySize } from "../../services/tauri";
import { updateGameAppinfoMediaIfChanged, saveGameMediaFile, persistGameAppInfo, clearSessionAppInfoCache, resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import { createMediaAdapter } from "../../services/mediaAdapter";
import { invalidateResolvedMediaCache, refreshGameDetailsArtwork } from "../../services/gameCacheService";
import { notifyMediaUpdated } from "../../services/startupSnapshotService";
import { resolveGameMetadata } from "../../services/gameMetadataResolver";
import { fetchIgdbArtworkDeduped, fetchRawgArtworkDeduped, fetchIgdbMetadataByName } from "../../services/storeArtworkResolver";
import { showSuccess, showError } from "../toast/GameToast";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import type { ManualGameEntry } from "../../services/manualGameStore";
import { getManualGame, saveManualGame, updateManualGame } from "../../services/manualGameStore";
import { readEpicOverrides, writeEpicOverrides } from "../../services/epicOverrideStore";
import { updateDebridGamePath, updateDebridGameAppId, updateDebridGameTitle, getDebridLaunchMetadata, getDebridGame } from "../../services/debridGameStore";
import GameImageSearchDialog from "./GameImageSearchDialog";
import GameMediaRoleRow from "./GameMediaRoleRow";
import { SourceOption } from "./GameMediaRoleRow";

// ── Constants ──

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB default
const SMALL_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB for icon/logo

// ── Types ──

export type GameEditDialogProps = {
  appId?: string;
  manualGameId?: string; // raw UUID — normalized internally
  epicProviderGameId?: string; // Epic provider game ID (e.g. "Fortnite" or "AppName")
  debridProviderGameId?: string; // Debrid provider game ID (from repack catalog)
  open: boolean;
  onClose: () => void;
  initialTab?: TabId;
  game?: LibraryGame | null;
  onMediaChanged?: () => void;
  settings?: {
    rawgApiKey?: string;
    igdbClientId?: string;
    igdbClientSecret?: string;
    steamGridDbApiKey?: string;
    steamGridDbArtworkEnabled?: boolean;
    googleSearchApiKey?: string;
    googleSearchCx?: string;
    bingSearchApiKey?: string;
  } | null;
};

type TabId = "details" | "installation" | "media" | "info";

type MediaRole = "cover" | "landscape" | "background" | "logo" | "icon";

type SourceId = "local" | "steam" | "sgdb" | "igdb" | "rawg" | "url" | "file";

type MetadataSourceId = "steam" | "igdb" | "rawg";

// ── Tab config ──
// TABS and MEDIA_ROLES are defined inside the component to support i18n t() calls.

const ROLE_TO_PATH_KEY: Record<MediaRole, keyof GameMediaPaths> = {
  cover: "coverPath",
  landscape: "landscapePath",
  background: "backgroundPath",
  logo: "logoPath",
  icon: "iconPath",
};

const DEBUG_MEDIA_EDIT = false;
const DEBUG_MANUAL_METADATA = false;

type RolePreviewStatus = "set" | "missing" | "unset" | "loading";

type RolePreviewEntry = {
  url: string | null;
  status: RolePreviewStatus;
};

// ── Helpers ──

function fileExtFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function readFileAsBase64(file: File): Promise<{ base64: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      const mime = result.substring(5, commaIdx);
      const base64 = commaIdx >= 0 ? result.substring(commaIdx + 1) : result;
      resolve({ base64, ext: fileExtFromMime(mime) });
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Steam Official Assets — CDN fallback URLs matching the auto-download pipeline. */
function buildSteamOfficialUrl(appId: string, role: string): string | null {
  const id = parseInt(appId, 10);
  if (!id || isNaN(id) || id <= 0) return null;
  switch (role) {
    case "cover": return `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`;
    case "landscape": return `https://steamcdn-a.akamaihd.net/steam/apps/${id}/header.jpg`;
    case "background": return `https://steamcdn-a.akamaihd.net/steam/apps/${id}/library_hero.jpg`;
    case "logo": return `https://steamcdn-a.akamaihd.net/steam/apps/${id}/logo.png`;
    default: return null;
  }
}

// ── Debug tracing for manual cover persistence ──
const DEBUG_MANUAL_COVER = false;

// ── Component ──

export default function GameEditDialog({
  appId,
  manualGameId,
  epicProviderGameId,
  debridProviderGameId,
  open,
  onClose,
  initialTab = "details",
  game,
  onMediaChanged,
  settings,
}: GameEditDialogProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Tab config (i18n) ──
  const TABS: { id: TabId; label: string; icon: typeof Type }[] = useMemo(() => [
    { id: "details", label: t("game_edit.tab_details", "Details"), icon: Type },
    { id: "installation", label: t("game_edit.tab_installation", "Installation"), icon: HardDrive },
    { id: "media", label: t("game_edit.tab_media", "Media"), icon: Image },
    { id: "info", label: t("game_edit.tab_info", "Info"), icon: Info },
  ], [t]);

  const MEDIA_ROLES: { role: MediaRole; label: string; icon: typeof FileImage; desc: string }[] = useMemo(() => [
    { role: "icon", label: t("game_edit.icon", "Icon"), icon: Camera, desc: t("game_edit.icon_desc", "Small square icon for sidebar and grid") },
    { role: "cover", label: t("game_edit.cover", "Cover Image"), icon: Monitor, desc: t("game_edit.cover_desc", "Poster/box art for library grid") },
    { role: "background", label: t("game_edit.background", "Background Image"), icon: Layers, desc: t("game_edit.background_desc", "Full hero background behind artwork") },
    { role: "landscape", label: t("game_edit.landscape", "Landscape Image"), icon: PanelTop, desc: t("game_edit.landscape_desc", "Wide hero/carousel image") },
    { role: "logo", label: t("game_edit.logo", "Logo"), icon: Palette, desc: t("game_edit.logo_desc", "Game logo for overlays and hero") },
  ], [t]);

  // Mode detection — manual games use manualGameId, Steam games use appId, Epic uses epicProviderGameId, Debrid uses debridProviderGameId
  const isManualMode = !!manualGameId && !appId && !epicProviderGameId && !debridProviderGameId;
  const isEpicMode = !!epicProviderGameId && !appId && !manualGameId && !debridProviderGameId;
  const isDebridMode = !!debridProviderGameId; // can coexist with appId (Steam appId for media)
  const isCreateMode = !appId && !manualGameId && !epicProviderGameId && !debridProviderGameId;
  const effectiveId = manualGameId ?? epicProviderGameId ?? debridProviderGameId ?? appId ?? "";

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // Sync initialTab when dialog opens
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Appinfo state
  const [appInfo, setAppInfo] = useState<GameAppInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Manual game state
  const [manualEntry, setManualEntry] = useState<ManualGameEntry | null>(null);
  const [createdManualId, setCreatedManualId] = useState<string | null>(null);

  // Epic override state
  const [epicOverrides, setEpicOverrides] = useState<Record<string, unknown> | null>(null);

  // Metadata state
  const [metadata, setMetadata] = useState<SteamAppMetadata | null>(null);

  // Installation field drafts (manual games only)
  const [executablePathDraft, setExecutablePathDraft] = useState("");
  const [workingDirectoryDraft, setWorkingDirectoryDraft] = useState("");
  const [launchArgsDraft, setLaunchArgsDraft] = useState("");
  const [installDirDraft, setInstallDirDraft] = useState("");

  // ── Editable field drafts (loaded from userData on mount) ──
  const [nameDraft, setNameDraft] = useState("");
  const [genresDraft, setGenresDraft] = useState("");
  const [developersDraft, setDevelopersDraft] = useState("");
  const [publishersDraft, setPublishersDraft] = useState("");
  const [categoriesDraft, setCategoriesDraft] = useState("");
  const [featuresDraft, setFeaturesDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [releaseDateDraft, setReleaseDateDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [sortingNameDraft, setSortingNameDraft] = useState("");

  // Reviews / scores
  const [userScoreDraft, setUserScoreDraft] = useState("");
  const [criticScoreDraft, setCriticScoreDraft] = useState("");
  const [communityScoreDraft, setCommunityScoreDraft] = useState("");
  const [reviewSummaryDraft, setReviewSummaryDraft] = useState("");
  const [reviewCountDraft, setReviewCountDraft] = useState("");
  const [reviewSourceDraft, setReviewSourceDraft] = useState("");

  // Additional metadata fields
  const [seriesDraft, setSeriesDraft] = useState("");
  const [ageRatingDraft, setAgeRatingDraft] = useState("");
  const [regionDraft, setRegionDraft] = useState("");
  const [completionStatusDraft, setCompletionStatusDraft] = useState("");

  // Linked IDs for manual games
  const [linkedIgdbIdDraft, setLinkedIgdbIdDraft] = useState<string | undefined>(undefined);

  // Steam App ID draft (editable for manual/debrid, readonly for steam/epic/lua)
  const [appIdDraft, setAppIdDraft] = useState("");

  // Download Metadata menu
  const [metadataMenuOpen, setMetadataMenuOpen] = useState(false);
  const [metadataDownloading, setMetadataDownloading] = useState(false);

  // Media URL input state per role
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>({});
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  // Browse source menu state per role
  const [browseOpenFor, setBrowseOpenFor] = useState<MediaRole | null>(null);
  const [browsingRole, setBrowsingRole] = useState<MediaRole | null>(null);

  // Media preview state (resolved via Rust resolveGameMediaPaths)
  const [rolePreviews, setRolePreviews] = useState<Record<string, RolePreviewEntry>>({});

  // Web Image Search modal state
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const [imageSearchRole, setImageSearchRole] = useState<MediaRole | null>(null);
  const lastImageSearchRoleRef = useRef<MediaRole | null>(null);

  // Refresh preview after image search dialog closes
  useEffect(() => {
    if (!imageSearchOpen && lastImageSearchRoleRef.current) {
      const role = lastImageSearchRoleRef.current;
      lastImageSearchRoleRef.current = null;
      // For manual games, re-read entry from store (image search wrote directly via updateManualGame)
      if ((isManualMode || isCreateMode) && (manualGameId || createdManualId)) {
        const targetId = manualGameId ?? createdManualId;
        if (targetId) {
          const refreshed = getManualGame(targetId);
          if (refreshed) {
            setManualEntry(refreshed);
            loadDraftsFromManualEntry(refreshed);
            if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][EDITOR_SET] manualId=${targetId} role=${role} savedPath=${refreshed[`${role}Path` as keyof ManualGameEntry]} entry=${JSON.stringify({ coverPath: refreshed.coverPath, landscapePath: refreshed.landscapePath, backgroundPath: refreshed.backgroundPath, logoPath: refreshed.logoPath, iconPath: refreshed.iconPath })}`);
          }
        }
      }
      refreshRolePreview(role);
    }
  }, [imageSearchOpen]);

  // File input ref per role
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Saving state
  const [saving, setSaving] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);

  // Library context for UI refresh
  const { updateGame } = useLibraryGames();

  // Steam media adapter (created before early returns for hook safety)
  const mediaAdapter = useMemo(() => {
    if (isDebridMode && appIdDraft) {
      return createMediaAdapter("steam", appIdDraft);
    }
    if (isManualMode && appIdDraft) {
      return createMediaAdapter("steam", appIdDraft);
    }
    if (isManualMode && manualGameId) {
      return createMediaAdapter("manual", manualGameId);
    }
    if (isEpicMode && epicProviderGameId) {
      return createMediaAdapter("epic", epicProviderGameId);
    }
    if (appId) {
      return createMediaAdapter("steam", appId);
    }
    return null;
  }, [appId, appIdDraft, manualGameId, epicProviderGameId, isManualMode, isEpicMode, isDebridMode]);

  // ── Load drafts from userData ──
  function loadDraftsFromUserData(info: GameAppInfo | null) {
    const ud = info?.userData ?? {};
    setNameDraft(info?.name ?? "");
    setGenresDraft(typeof ud.genres === "string" ? ud.genres : "");
    setDevelopersDraft(typeof ud.developers === "string" ? ud.developers : "");
    setPublishersDraft(typeof ud.publishers === "string" ? ud.publishers : "");
    setCategoriesDraft(typeof ud.categories === "string" ? ud.categories : "");
    setFeaturesDraft(typeof ud.features === "string" ? ud.features : "");
    setTagsDraft(typeof ud.tags === "string" ? ud.tags : "");
    setReleaseDateDraft(typeof ud.releaseDate === "string" ? ud.releaseDate : "");
    setDescriptionDraft(typeof ud.description === "string" ? ud.description : "");
    setSortingNameDraft(typeof ud.sortingName === "string" ? ud.sortingName : "");
    setUserScoreDraft(typeof ud.userScore === "string" ? ud.userScore : "");
    setCriticScoreDraft(typeof ud.criticScore === "string" ? ud.criticScore : "");
    setCommunityScoreDraft(typeof ud.communityScore === "string" ? ud.communityScore : "");
    setReviewSummaryDraft(typeof ud.reviewSummary === "string" ? ud.reviewSummary : "");
    setReviewCountDraft(typeof ud.reviewCount === "string" ? ud.reviewCount : "");
    setReviewSourceDraft(typeof ud.reviewSource === "string" ? ud.reviewSource : "");
    setSeriesDraft(typeof ud.series === "string" ? ud.series : "");
    setAgeRatingDraft(typeof ud.ageRating === "string" ? ud.ageRating : "");
    setRegionDraft(typeof ud.region === "string" ? ud.region : "");
    setCompletionStatusDraft(typeof ud.completionStatus === "string" ? ud.completionStatus : "");
  }

  // ── Load drafts from ManualGameEntry ──
  function loadDraftsFromManualEntry(entry: ManualGameEntry) {
    setNameDraft(entry.name ?? "");
    setGenresDraft(entry.genres?.join(", ") ?? "");
    setDevelopersDraft(entry.developers?.join(", ") ?? "");
    setPublishersDraft(entry.publishers?.join(", ") ?? "");
    setCategoriesDraft(entry.categories?.join(", ") ?? "");
    setFeaturesDraft(entry.features?.join(", ") ?? "");
    setTagsDraft(entry.tags?.join(", ") ?? "");
    setReleaseDateDraft(entry.releaseDate ?? "");
    setDescriptionDraft(entry.description ?? "");
    setLinkedIgdbIdDraft(entry.linkedIgdbId ?? undefined);
    setSortingNameDraft(entry.sortingName ?? "");
    setUserScoreDraft(entry.userScore ?? "");
    setCriticScoreDraft(entry.criticScore ?? "");
    setCommunityScoreDraft(entry.communityScore ?? "");
    setReviewSummaryDraft(entry.reviewSummary ?? "");
    setReviewCountDraft(entry.reviewCount ?? "");
    setReviewSourceDraft(entry.reviewSource ?? "");
    setSeriesDraft(entry.series ?? "");
    setAgeRatingDraft(entry.ageRating ?? "");
    setRegionDraft(entry.region ?? "");
    setCompletionStatusDraft(entry.completionStatus ?? "");
    // Installation fields
    setExecutablePathDraft(entry.executablePath ?? "");
    setWorkingDirectoryDraft(entry.workingDirectory ?? "");
    setLaunchArgsDraft(entry.launchArguments ?? "");
    setInstallDirDraft(entry.installDir ?? "");
    setAppIdDraft(entry.appId ?? entry.linkedSteamAppId ?? "");
  }

  // ── Load appinfo or manual entry on mount ──

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setUrlInputs({});
    setExpandedUrl(null);
    setBrowseOpenFor(null);
    setBrowsingRole(null);
    setHasEdits(false);
    setRolePreviews({});
    setManualEntry(null);
    setCreatedManualId(null);
    setExecutablePathDraft("");
    setWorkingDirectoryDraft("");
    setLaunchArgsDraft("");
    setInstallDirDraft("");
    setLinkedIgdbIdDraft(undefined);

    // Manual edit mode — load from manualGameStore
    let resolvedAppId = appId || "";
    if (isManualMode && manualGameId) {
      const entry = getManualGame(manualGameId);
      if (entry) {
        setManualEntry(entry);
        loadDraftsFromManualEntry(entry);
        setAppIdDraft(entry.appId ?? "");
        setExecutablePathDraft(entry.executablePath ?? "");
        setWorkingDirectoryDraft(entry.workingDirectory ?? "");
        setLaunchArgsDraft(entry.launchArguments ?? "");
        setInstallDirDraft(entry.installDir ?? "");
        resolvedAppId = entry.appId ?? "";
      }
      // Manual WITHOUT appId → standalone (no Steam data)
      if (!resolvedAppId) {
        setLoading(false);
        loadRolePreviews();
        return;
      }
      // Manual WITH appId → fall through to Steam path for appInfo + metadata
    }

    // Debrid edit mode — pre-fill install dir + appId + launch config from game data.
    // The in-memory game may be a fresh catalog entry (isInstalled=false, no paths)
    // while the launch metadata still lives in the debrid store — fall back to it
    // so the dialog always shows what was saved on disk.
    if (isDebridMode && debridProviderGameId) {
      const savedMeta = getDebridLaunchMetadata(debridProviderGameId);
      const savedGame = getDebridGame(debridProviderGameId);
      const dir = game?.installDir || savedMeta?.installDir || savedGame?.installDir || "";
      const exe = game?.executablePath || savedMeta?.executablePath || savedGame?.executablePath || "";
      const wd = game?.workingDirectory || savedMeta?.workingDirectory || savedGame?.workingDirectory || "";
      const args = game?.launchArguments || savedMeta?.launchArguments || savedGame?.launchArguments || "";
      setNameDraft(game?.title ?? savedGame?.title ?? "");
      if (dir) setInstallDirDraft(dir);
      if (exe) setExecutablePathDraft(exe);
      if (wd) setWorkingDirectoryDraft(wd);
      if (args) setLaunchArgsDraft(args);
      resolvedAppId = game?.appId ?? savedGame?.appId ?? "";
      setAppIdDraft(resolvedAppId);

      // Debrid WITHOUT appId → standalone
      if (!resolvedAppId) {
        setLoading(false);
        loadRolePreviews();
        return;
      }
      // Debrid WITH appId → fall through to Steam path for appInfo + metadata
    }

    // Epic edit mode — load from Epic override store
    if (isEpicMode && epicProviderGameId) {
      const overrides = readEpicOverrides(epicProviderGameId);
      if (overrides) {
        // Populate drafts from overrides
        if (overrides.name) setNameDraft(overrides.name);
        if (overrides.sortingName) setSortingNameDraft(overrides.sortingName);
        if (overrides.description) setDescriptionDraft(overrides.description);
        if (overrides.genres?.length) setGenresDraft(overrides.genres.join(", "));
        if (overrides.developers?.length) setDevelopersDraft(overrides.developers.join(", "));
        if (overrides.publishers?.length) setPublishersDraft(overrides.publishers.join(", "));
        if (overrides.categories?.length) setCategoriesDraft(overrides.categories.join(", "));
        if (overrides.features?.length) setFeaturesDraft(overrides.features.join(", "));
        if (overrides.tags?.length) setTagsDraft(overrides.tags.join(", "));
        if (overrides.releaseDate) setReleaseDateDraft(overrides.releaseDate);
        if (overrides.series) setSeriesDraft(overrides.series);
        if (overrides.ageRating) setAgeRatingDraft(overrides.ageRating);
        if (overrides.region) setRegionDraft(overrides.region);
        if (overrides.linkedSteamAppId) setLinkedIgdbIdDraft(overrides.linkedIgdbId);
        setAppIdDraft(game?.appId ?? overrides.linkedSteamAppId ?? "");
        setEpicOverrides(overrides as unknown as Record<string, unknown>);
      }
      setLoading(false);
      loadRolePreviews();
      return;
    }

    // Create mode — blank form, no data to load
    if (isCreateMode) {
      setLoading(false);
      return;
    }

    // Steam edit mode (also handles Manual+appId and Debrid+appId that fell through)
    if (!resolvedAppId) resolvedAppId = appId ?? "";
    setAppIdDraft(resolvedAppId);
    if (resolvedAppId) {
      getGameAppInfo(resolvedAppId).then((info) => {
        setAppInfo(info);
        loadDraftsFromUserData(info);
        setLoading(false);
        // loadRolePreviews() called by the useEffect below after mediaAdapter re-computes
      });
      const appIdNum = Number(resolvedAppId);
      if (!isNaN(appIdNum) && appIdNum > 0) {
        resolveGameMetadata([appIdNum]).then((m) => {
          const meta = m[appIdNum];
          setMetadata(meta ?? null);
          if (meta) fillDraftsFromMetadata(meta);
          setLoading(false);
        }).catch(() => {});
      }
    }
  }, [open, appId, manualGameId]);

  // ── Load role previews after mediaAdapter + appInfo are ready ──
  // This runs after the mount effect sets appIdDraft/appInfo, ensuring
  // mediaAdapter has re-computed via useMemo before loadRolePreviews reads it.
  useEffect(() => {
    if (!open) return;
    if (isCreateMode) return;
    if (!mediaAdapter && !(isManualMode || isCreateMode)) return;
    loadRolePreviews();
  }, [open, appIdDraft, appInfo, mediaAdapter]);

  // ── Fill drafts from metadata on Download ──
  function fillDraftsFromMetadata(meta: SteamAppMetadata, mergeName?: string) {
    if (mergeName) setNameDraft(mergeName);
    if (meta.genres?.length) setGenresDraft(meta.genres.join(", "));
    if (meta.developer) setDevelopersDraft(meta.developer);
    if (meta.publishers?.length) setPublishersDraft(meta.publishers.join(", "));
    if (meta.categories?.length) setCategoriesDraft(meta.categories.join(", "));
    if (meta.release_date) setReleaseDateDraft(meta.release_date);
    if (meta.short_description || meta.about_the_game) {
      setDescriptionDraft(meta.short_description ?? meta.about_the_game ?? "");
    }
    setHasEdits(true);
  }

  // ── Download Metadata handler ──
  const handleDownloadMetadata = useCallback(async (source: MetadataSourceId) => {
    setMetadataMenuOpen(false);
    if (!appId && !isManualMode && !isCreateMode && !isEpicMode && !isDebridMode) return;

    // Manual/create: IGDB or Steam name search
    if (isManualMode || isCreateMode) {
      // Manual+appId: resolve by appId directly (no name search needed)
      const manualAppId = appIdDraft.trim();
      if (manualAppId && source === "steam") {
        setMetadataDownloading(true);
        try {
          const appIdNum = Number(manualAppId);
          if (!isNaN(appIdNum)) {
            if (DEBUG_MANUAL_METADATA) console.log(`[MANUAL][META] appId=${appIdNum} source=steam — direct appId resolution`);
            const m = await resolveGameMetadata([appIdNum]);
            const meta = m[appIdNum];
            if (meta) {
              fillDraftsFromMetadata(meta, meta.name ?? undefined);
              setMetadata(meta);
              showSuccess(t("game_edit.toast_metadata_downloaded_steam", "Metadata downloaded from Steam"));
            } else {
              showError(t("game_edit.toast_no_steam_metadata", "No Steam metadata available for this app"));
            }
          }
        } catch {
          showError(t("game_edit.toast_failed_download_steam", "Failed to download Steam metadata"));
        }
        setMetadataDownloading(false);
        return;
      }

      const searchName = nameDraft.trim();
      if (!searchName) {
        showError(t("game_edit.enter_name_first", "Enter a game name first"));
        return;
      }
      setMetadataDownloading(true);
      if (DEBUG_MANUAL_METADATA) console.log(`[MANUAL][META] source=${source} searchName="${searchName}" isManual=${isManualMode} isCreate=${isCreateMode}`);

      try {
        if (source === "igdb") {
          if (!settings?.igdbClientId || !settings?.igdbClientSecret) {
            showError(t("game_edit.configure_igdb_first", "Configure IGDB credentials in Settings first"));
            setMetadataDownloading(false);
            return;
          }
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] calling fetchIgdbMetadataByName...");
          const result = await fetchIgdbMetadataByName(settings.igdbClientId, settings.igdbClientSecret, searchName);
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] IGDB result:", result);
          if (result) {
            if (result.igdbId) setLinkedIgdbIdDraft(String(result.igdbId));
            if (result.name) setNameDraft(result.name);
            if (result.genres?.length) setGenresDraft(result.genres.join(", "));
            if (result.developers?.length) setDevelopersDraft(result.developers.join(", "));
            if (result.publishers?.length) setPublishersDraft(result.publishers.join(", "));
            if (result.releaseDate) setReleaseDateDraft(result.releaseDate);
            if (result.summary) setDescriptionDraft(result.summary);
            setHasEdits(true);
            if (result.coverUrl) {
              showSuccess(t("game_edit.found_on_igdb", `Found "{{name}}" on IGDB — metadata filled. Use Media tab to add artwork.`, { name: result.name ?? searchName }));
            } else {
              showSuccess(t("game_edit.metadata_filled_igdb", "Metadata filled from IGDB"));
            }
          } else {
            if (DEBUG_MANUAL_METADATA) console.warn("[MANUAL][META] IGDB returned null — no results or auth failure");
            showError(t("game_edit.no_igdb_results", `No IGDB results for "{{name}}"`, { name: searchName }));
          }
        } else if (source === "steam") {
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] calling resolveSteamStoreSearch...");
          const steamResults = await resolveSteamStoreSearch({ term: searchName, limit: 5 });
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] Steam results:", steamResults);
          if (!steamResults || steamResults.length === 0) {
              showError(t("game_edit.no_steam_results", `No Steam results for "{{name}}"`, { name: searchName }));
            setMetadataDownloading(false);
            return;
          }
          const best = steamResults[0];
          if (DEBUG_MANUAL_METADATA) console.log(`[MANUAL][META] best match: appId=${best.app_id} name="${best.name}"`);
          setLinkedIgdbIdDraft(undefined);
          if (best.name) setNameDraft(best.name);
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] resolving Steam metadata for appId:", best.app_id);
          const metaMap = await resolveGameMetadata([best.app_id]);
          const meta = metaMap[best.app_id];
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] Steam metadata:", meta);
          if (meta) {
            if (meta.developer) setDevelopersDraft(meta.developer);
            if (meta.publishers?.length) setPublishersDraft(meta.publishers.join(", "));
            if (meta.genres?.length) setGenresDraft(meta.genres.join(", "));
            if (meta.release_date) setReleaseDateDraft(meta.release_date);
            if (meta.short_description || meta.about_the_game) setDescriptionDraft(meta.short_description ?? meta.about_the_game ?? "");
            if (meta.name && meta.name !== best.name) setNameDraft(meta.name);
            setHasEdits(true);
            showSuccess(t("game_edit.found_on_steam_metadata", `Found "{{name}}" on Steam — metadata filled. Use Media tab to add artwork.`, { name: meta.name ?? best.name }));
          } else {
            setHasEdits(true);
            showSuccess(t("game_edit.found_on_steam_name", `Found "{{name}}" on Steam — name filled. Metadata not available for this app.`, { name: best.name }));
          }
        }
      } catch (e) {
        if (DEBUG_MANUAL_METADATA) console.error("[MANUAL][META] error:", e);
        showError(t("game_edit.failed_search_source", `Failed to search {{source}}`, { source: source === "igdb" ? "IGDB" : "Steam" }));
      }
      setMetadataDownloading(false);
      return;
    }

    // Epic games: search Steam by game name (same as manual Steam path)
    if (isEpicMode) {
      const searchName = nameDraft.trim() || game?.title || "";
      if (!searchName) {
        showError(t("game_edit.enter_name_or_title", "Enter a game name first or use the game title"));
        setMetadataDownloading(false);
        return;
      }
      setMetadataDownloading(true);
      try {
        if (source === "steam") {
          if (DEBUG_MANUAL_METADATA) console.log(`[EPIC][META] source=steam searchName="${searchName}"`);
          const steamResults = await resolveSteamStoreSearch({ term: searchName, limit: 5 });
          if (DEBUG_MANUAL_METADATA) console.log("[EPIC][META] Steam results:", steamResults);
          if (!steamResults || steamResults.length === 0) {
            showError(`No Steam results for "${searchName}"`);
            setMetadataDownloading(false);
            return;
          }
          const best = steamResults[0];
          if (DEBUG_MANUAL_METADATA) console.log(`[EPIC][META] best match: appId=${best.app_id} name="${best.name}"`);
          if (best.name) setNameDraft(best.name);
          const metaMap = await resolveGameMetadata([best.app_id]);
          const meta = metaMap[best.app_id];
          if (DEBUG_MANUAL_METADATA) console.log("[EPIC][META] Steam metadata:", meta);
          if (meta) {
            if (meta.developer) setDevelopersDraft(meta.developer);
            if (meta.publishers?.length) setPublishersDraft(meta.publishers.join(", "));
            if (meta.genres?.length) setGenresDraft(meta.genres.join(", "));
            if (meta.release_date) setReleaseDateDraft(meta.release_date);
            if (meta.short_description || meta.about_the_game) setDescriptionDraft(meta.short_description ?? meta.about_the_game ?? "");
            if (meta.name && meta.name !== best.name) setNameDraft(meta.name);
            setHasEdits(true);
            showSuccess(`Found "${meta.name ?? best.name}" on Steam — metadata filled. Use Media tab to add artwork.`);
          } else {
            setHasEdits(true);
            showSuccess(`Found "${best.name}" on Steam — name filled. Metadata not available for this app.`);
          }
        } else if (source === "igdb") {
          if (!settings?.igdbClientId || !settings?.igdbClientSecret) {
            showError(t("game_edit.configure_igdb_first", "Configure IGDB credentials in Settings first"));
            setMetadataDownloading(false);
            return;
          }
          if (DEBUG_MANUAL_METADATA) console.log(`[EPIC][META] source=igdb searchName="${searchName}"`);
          const result = await fetchIgdbMetadataByName(settings.igdbClientId, settings.igdbClientSecret, searchName);
          if (DEBUG_MANUAL_METADATA) console.log("[EPIC][META] IGDB result:", result);
          if (result) {
            if (result.name) setNameDraft(result.name);
            if (result.genres?.length) setGenresDraft(result.genres.join(", "));
            if (result.developers?.length) setDevelopersDraft(result.developers.join(", "));
            if (result.publishers?.length) setPublishersDraft(result.publishers.join(", "));
            if (result.releaseDate) setReleaseDateDraft(result.releaseDate);
            if (result.summary) setDescriptionDraft(result.summary);
            setHasEdits(true);
            showSuccess(`Found "${result.name ?? searchName}" on IGDB — metadata filled. Use Media tab to add artwork.`);
          } else {
            showError(`No IGDB results for "${searchName}"`);
          }
        }
      } catch (e) {
        if (DEBUG_MANUAL_METADATA) console.error("[EPIC][META] error:", e);
        showError(t("game_edit.failed_search_source", `Failed to search {{source}}`, { source: source === "steam" ? "Steam" : "IGDB" }));
      }
      setMetadataDownloading(false);
      return;
    }

    // Debrid games — resolve by the Steam appId from the dialog or game data.
    // Repack installs share the Steam appId; metadata only fills the dialog
    // fields (nothing is written to appinfo.json — that stays session-level).
    if (isDebridMode) {
      const steamAppId = appIdDraft.trim() || (game?.appId ? String(game.appId) : "");
      if (!steamAppId) {
        showError(t("game_edit.no_steam_appid", "No Steam App ID — enter one in the App ID field"));
        setMetadataDownloading(false);
        return;
      }
      const appIdNum = Number(steamAppId);
      if (isNaN(appIdNum)) {
        showError(t("game_edit.invalid_steam_appid", "Invalid Steam App ID"));
        setMetadataDownloading(false);
        return;
      }
      setMetadataDownloading(true);
      try {
        if (source === "steam") {
          const m = await resolveGameMetadata([appIdNum]);
          const meta = m[appIdNum];
          if (meta) {
            fillDraftsFromMetadata(meta, meta.name ?? undefined);
            setMetadata(meta);
            showSuccess(t("game_edit.toast_metadata_downloaded_steam", "Metadata downloaded from Steam"));
          } else {
            showError(t("game_edit.toast_no_steam_metadata", "No Steam metadata available for this app"));
          }
        } else if (source === "igdb") {
          if (!settings?.igdbClientId || !settings?.igdbClientSecret) {
            showError(t("game_edit.configure_igdb_first", "Configure IGDB credentials in Settings first"));
            setMetadataDownloading(false);
            return;
          }
          const igdbData = await fetchIgdbArtworkDeduped({
            clientId: settings.igdbClientId,
            clientSecret: settings.igdbClientSecret,
            appId: steamAppId,
          });
          if (igdbData) {
            showSuccess(t("game_edit.metadata_downloaded_igdb", "Metadata downloaded from IGDB"));
            setHasEdits(true);
          } else {
            showError(t("game_edit.no_igdb_data", "No IGDB data available for this app"));
          }
        } else if (source === "rawg") {
          if (!settings?.rawgApiKey) {
            showError(t("game_edit.configure_rawg_first", "Configure RAWG API key in Settings first"));
            setMetadataDownloading(false);
            return;
          }
          const rawgData = await fetchRawgArtworkDeduped({
            apiKey: settings.rawgApiKey,
            appId: steamAppId,
          });
          if (rawgData) {
            showSuccess(t("game_edit.metadata_downloaded_rawg", "Metadata downloaded from RAWG"));
            setHasEdits(true);
          } else {
            showError(t("game_edit.no_rawg_data", "No RAWG data available for this app"));
          }
        }
      } catch {
        showError(t("game_edit.failed_download_metadata", `Failed to download metadata from {{source}}`, { source }));
      }
      setMetadataDownloading(false);
      return;
    }

    // Steam games — existing flow
    if (!appId) { setMetadataDownloading(false); return; }
    setMetadataDownloading(true);
    try {
      if (source === "steam") {
        const appIdNum = Number(appId);
        if (!isNaN(appIdNum)) {
          const m = await resolveGameMetadata([appIdNum]);
          const meta = m[appIdNum];
          if (meta) {
            fillDraftsFromMetadata(meta, meta.name ?? undefined);
            setMetadata(meta);
            showSuccess(t("game_edit.toast_metadata_downloaded_steam", "Metadata downloaded from Steam"));
          } else {
            showError(t("game_edit.toast_no_steam_metadata", "No Steam metadata available for this app"));
          }
        }
      } else if (source === "igdb") {
        if (!settings?.igdbClientId || !settings?.igdbClientSecret) {
          showError(t("game_edit.configure_igdb_first", "Configure IGDB credentials in Settings first"));
          return;
        }
        const igdbData = await fetchIgdbArtworkDeduped({
          clientId: settings.igdbClientId,
          clientSecret: settings.igdbClientSecret,
          appId,
        });
        if (igdbData) {
          showSuccess(t("game_edit.metadata_downloaded_igdb", "Metadata downloaded from IGDB"));
          setHasEdits(true);
        } else {
          showError(t("game_edit.no_igdb_data", "No IGDB data available for this app"));
        }
      } else if (source === "rawg") {
        if (!settings?.rawgApiKey) {
          showError(t("game_edit.configure_rawg_first", "Configure RAWG API key in Settings first"));
          return;
        }
        const rawgData = await fetchRawgArtworkDeduped({
          apiKey: settings.rawgApiKey,
          appId,
        });
        if (rawgData) {
          showSuccess(t("game_edit.metadata_downloaded_rawg", "Metadata downloaded from RAWG"));
          setHasEdits(true);
        } else {
          showError(t("game_edit.no_rawg_data", "No RAWG data available for this app"));
        }
      }
    } catch {
      showError(t("game_edit.failed_download_metadata", `Failed to download metadata from {{source}}`, { source }));
    }
    setMetadataDownloading(false);
  }, [appId, settings, isManualMode, isCreateMode, isEpicMode, isDebridMode, nameDraft, game?.title]);

  // ── Build userData from drafts ──
  function buildUserData(): Record<string, unknown> {
    const ud: Record<string, unknown> = {};
    if (genresDraft) ud.genres = genresDraft;
    if (developersDraft) ud.developers = developersDraft;
    if (publishersDraft) ud.publishers = publishersDraft;
    if (categoriesDraft) ud.categories = categoriesDraft;
    if (featuresDraft) ud.features = featuresDraft;
    if (tagsDraft) ud.tags = tagsDraft;
    if (releaseDateDraft) ud.releaseDate = releaseDateDraft;
    if (descriptionDraft) ud.description = descriptionDraft;
    if (sortingNameDraft) ud.sortingName = sortingNameDraft;
    if (userScoreDraft) ud.userScore = userScoreDraft;
    if (criticScoreDraft) ud.criticScore = criticScoreDraft;
    if (communityScoreDraft) ud.communityScore = communityScoreDraft;
    if (reviewSummaryDraft) ud.reviewSummary = reviewSummaryDraft;
    if (reviewCountDraft) ud.reviewCount = reviewCountDraft;
    if (reviewSourceDraft) ud.reviewSource = reviewSourceDraft;
    if (seriesDraft) ud.series = seriesDraft;
    if (ageRatingDraft) ud.ageRating = ageRatingDraft;
    if (regionDraft) ud.region = regionDraft;
    if (completionStatusDraft) ud.completionStatus = completionStatusDraft;
    return ud;
  }

  // ── Open media folder ──

  const handleOpenMediaFolder = useCallback(async () => {
    try {
      if (isEpicMode && epicProviderGameId) {
        await openProviderMediaFolder("epic", epicProviderGameId);
      } else if (appId || appIdDraft) {
        await openGameMediaFolder(appId || appIdDraft);
      } else if (isManualMode && manualGameId) {
        await openProviderMediaFolder("manual", manualGameId);
      }
    } catch {
      showError(t("game_edit.error_media_folder", "Could not open media folder"));
    }
  }, [appId, appIdDraft, manualGameId, epicProviderGameId, isManualMode, isEpicMode]);

  const handleBrowseExe = useCallback(async () => {
    const fullPath = await pickFile(t("game_edit.select_executable", "Select Executable"), [
      { name: "Executables", extensions: ["exe", "bat", "cmd", "lnk", "msi"] },
    ]);
    if (!fullPath) return;
    setExecutablePathDraft(fullPath);
    if (!workingDirectoryDraft.trim()) {
      const parentDir = fullPath.includes("/") || fullPath.includes("\\")
        ? fullPath.replace(/[\\/][^/\\]+$/, "")
        : "";
      if (parentDir) setWorkingDirectoryDraft(parentDir);
    }
    if (!installDirDraft.trim()) {
      const parentDir = fullPath.includes("/") || fullPath.includes("\\")
        ? fullPath.replace(/[\\/][^/\\]+$/, "")
        : "";
      if (parentDir) setInstallDirDraft(parentDir);
    }
    setHasEdits(true);
  }, [workingDirectoryDraft, installDirDraft]);

  const handleOpenInstallFolder = useCallback(async () => {
    // For Debrid: prefer exe parent directory (real game location) over extraction folder
    const exe = executablePathDraft.trim();
    let folder = "";
    if (exe) {
      const sep = Math.max(exe.lastIndexOf("\\"), exe.lastIndexOf("/"));
      if (sep > 0) folder = exe.substring(0, sep);
    }
    if (!folder) folder = installDirDraft.trim() || game?.installDir || "";
    if (!folder) {
      showError(t("game_edit.error_install_folder", "No install folder configured"));
      return;
    }
    try {
      await openFolder(folder);
    } catch {
      showError(t("game_edit.error_open_folder", "Could not open install folder"));
    }
  }, [executablePathDraft, installDirDraft, game]);

  // ── Save all fields ──
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // ── Manual game create/edit ──
      if (isManualMode || isCreateMode) {
        const parseList = (s: string): string[] =>
          s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];

        // Read current media paths from store (NOT from stale closure manualEntry)
        const freshMediaEntry = getManualGame(createdManualId ?? manualGameId ?? "") ?? manualEntry;

        if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][BEFORE_SAVE] manualId=${createdManualId ?? manualGameId} storeEntry=${JSON.stringify(freshMediaEntry ? { coverPath: freshMediaEntry.coverPath, landscapePath: freshMediaEntry.landscapePath, backgroundPath: freshMediaEntry.backgroundPath, logoPath: freshMediaEntry.logoPath, iconPath: freshMediaEntry.iconPath } : null)} manualEntry=${JSON.stringify(manualEntry ? { coverPath: manualEntry.coverPath } : null)}`);

        const patch: Partial<ManualGameEntry> = {
          name: nameDraft || t("game_edit.untitled", "Untitled Game"),
          genres: parseList(genresDraft),
          developers: parseList(developersDraft),
          publishers: parseList(publishersDraft),
          categories: parseList(categoriesDraft),
          features: parseList(featuresDraft),
          tags: parseList(tagsDraft),
          releaseDate: releaseDateDraft || undefined,
          description: descriptionDraft || undefined,
          sortingName: sortingNameDraft || undefined,
          userScore: userScoreDraft || undefined,
          criticScore: criticScoreDraft || undefined,
          communityScore: communityScoreDraft || undefined,
          reviewSummary: reviewSummaryDraft || undefined,
          reviewCount: reviewCountDraft || undefined,
          reviewSource: reviewSourceDraft || undefined,
          series: seriesDraft || undefined,
          ageRating: ageRatingDraft || undefined,
          region: regionDraft || undefined,
          completionStatus: completionStatusDraft || undefined,
          executablePath: executablePathDraft.trim().replace(/^["']|["']$/g, "") || undefined,
          workingDirectory: workingDirectoryDraft.trim().replace(/^["']|["']$/g, "") || undefined,
          launchArguments: launchArgsDraft.trim() || undefined,
          installDir: installDirDraft.trim().replace(/^["']|["']$/g, "") || undefined,
          linkedIgdbId: linkedIgdbIdDraft || undefined,
          appId: appIdDraft || undefined,
          coverPath: freshMediaEntry?.coverPath,
          landscapePath: freshMediaEntry?.landscapePath,
          backgroundPath: freshMediaEntry?.backgroundPath,
          logoPath: freshMediaEntry?.logoPath,
          iconPath: freshMediaEntry?.iconPath,
        };

        if (createdManualId || (manualGameId && !isCreateMode)) {
          // Update existing manual game (either first-create-then-save-again, or edit)
          const targetId = manualGameId && !isCreateMode ? manualGameId : createdManualId!;
          const updated = updateManualGame(targetId, patch);
          if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][AFTER_SAVE] manualId=${targetId} savedEntry=${JSON.stringify({ coverPath: updated.coverPath, landscapePath: updated.landscapePath, backgroundPath: updated.backgroundPath, logoPath: updated.logoPath, iconPath: updated.iconPath })}`);
          setManualEntry(updated);
          setCreatedManualId(targetId);
          showSuccess(t("game_edit.save_success", "Game details saved"));

          // Calculate sizeOnDisk if installDir exists
          const installDirForSize = installDirDraft.trim().replace(/^["']|["']$/g, "");
          if (installDirForSize) {
            calculateDirectorySize(installDirForSize).then((bytes) => {
              if (bytes > 0) {
                updateManualGame(targetId, { sizeOnDisk: bytes });
                updateGame(game?.appId ?? targetId, { sizeOnDisk: bytes } as Partial<LibraryGame>);
              }
            }).catch(() => { });
          }

          // If manual game has appId, also persist full userData to Steam appinfo (same as Steam save path)
          if (appIdDraft) {
            const media: import("../../services/tauri").GameMediaPaths = {
              coverPath: freshMediaEntry?.coverPath ?? null,
              landscapePath: freshMediaEntry?.landscapePath ?? null,
              backgroundPath: freshMediaEntry?.backgroundPath ?? null,
              logoPath: freshMediaEntry?.logoPath ?? null,
              iconPath: freshMediaEntry?.iconPath ?? null,
            };
            const userData = buildUserData();
            const updatedEntry: import("../../services/tauri").GameAppInfo = {
              appId: appIdDraft,
              provider: appInfo?.provider ?? "steam",
              name: nameDraft || null,
              updatedAt: Math.floor(Date.now() / 1000),
              media,
              mediaSources: appInfo?.mediaSources ?? null,
              remote: appInfo?.remote ?? null,
              userData: Object.keys(userData).length > 0 ? userData : null,
            };
            await persistGameAppInfo(appIdDraft, updatedEntry);
            clearSessionAppInfoCache(appIdDraft);
            notifyMediaUpdated(appIdDraft);
            updateGame(appIdDraft, { title: nameDraft || undefined } as Partial<LibraryGame>);
            onMediaChanged?.();
            setAppInfo(updatedEntry);
          }
        } else {
          // Create new manual game
          const newId = crypto.randomUUID();
          const newEntry: ManualGameEntry = {
            id: newId,
            name: patch.name ?? t("game_edit.untitled", "Untitled Game"),
            genres: patch.genres,
            developers: patch.developers,
            publishers: patch.publishers,
            categories: patch.categories,
            features: patch.features,
            tags: patch.tags,
            releaseDate: patch.releaseDate,
            description: patch.description,
            sortingName: patch.sortingName,
            userScore: patch.userScore,
            criticScore: patch.criticScore,
            communityScore: patch.communityScore,
            reviewSummary: patch.reviewSummary,
            reviewCount: patch.reviewCount,
            reviewSource: patch.reviewSource,
            series: patch.series,
            ageRating: patch.ageRating,
            region: patch.region,
            completionStatus: patch.completionStatus,
            executablePath: patch.executablePath,
            workingDirectory: patch.workingDirectory,
            launchArguments: patch.launchArguments,
            installDir: patch.installDir,
            linkedIgdbId: patch.linkedIgdbId,
            appId: patch.appId,
            // Preserve media paths from store (already in patch from freshMediaEntry)
            coverPath: patch.coverPath,
            landscapePath: patch.landscapePath,
            backgroundPath: patch.backgroundPath,
            logoPath: patch.logoPath,
            iconPath: patch.iconPath,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          saveManualGame(newEntry);
          if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][AFTER_SAVE] manualId=${newId} createdEntry=${JSON.stringify({ coverPath: newEntry.coverPath, landscapePath: newEntry.landscapePath, backgroundPath: newEntry.backgroundPath, logoPath: newEntry.logoPath, iconPath: newEntry.iconPath })}`);
          setCreatedManualId(newId);
          setManualEntry(newEntry);
          showSuccess(t("game_edit.manual_created", "Manual game created"));

          // Calculate sizeOnDisk if installDir exists
          const installDirForSize = installDirDraft.trim().replace(/^["']|["']$/g, "");
          if (installDirForSize) {
            calculateDirectorySize(installDirForSize).then((bytes) => {
              if (bytes > 0) {
                updateManualGame(newId, { sizeOnDisk: bytes });
              }
            }).catch(() => { });
          }
        }
        setHasEdits(false);
        setSaving(false);
        return;
      }

      // ── Epic game save ──
      if (isEpicMode && epicProviderGameId) {
        const parseList = (s: string): string[] =>
          s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];

        writeEpicOverrides(epicProviderGameId, {
          name: nameDraft || undefined,
          sortingName: sortingNameDraft || undefined,
          description: descriptionDraft || undefined,
          genres: parseList(genresDraft),
          developers: parseList(developersDraft),
          publishers: parseList(publishersDraft),
          categories: parseList(categoriesDraft),
          features: parseList(featuresDraft),
          tags: parseList(tagsDraft),
          releaseDate: releaseDateDraft || undefined,
          series: seriesDraft || undefined,
          ageRating: ageRatingDraft || undefined,
          region: regionDraft || undefined,
        });

        // Title update is handled by the epicOverrideStore → epicGameStore subscription chain.
        // No need to call updateGame here — it only matches by appId (undefined for Epic).

        setHasEdits(false);
        showSuccess(t("game_edit.epic_saved", "Epic game details saved"));
        onMediaChanged?.();
        setSaving(false);
        return;
      }

      // ── Debrid game save (install path + appId + launch config) ──
      if (isDebridMode && debridProviderGameId) {
        const dir = installDirDraft.trim().replace(/^["']|["']$/g, "");
        const exe = executablePathDraft.trim() || undefined;
        const wd = workingDirectoryDraft.trim() || undefined;
        const args = launchArgsDraft.trim() || undefined;
        const ok = updateDebridGamePath(debridProviderGameId, dir, exe, wd, args);
        if (appIdDraft) {
          updateDebridGameAppId(debridProviderGameId, appIdDraft);
        }
        let titleOk = true;
        if (nameDraft.trim()) {
          titleOk = updateDebridGameTitle(debridProviderGameId, nameDraft);
        }

        // Persist full userData to Steam appinfo when Debrid has appId (same as Steam save path)
        if (appIdDraft) {
          const debridMedia: GameMediaPaths = {
            coverPath: appInfo?.media?.coverPath ?? null,
            landscapePath: appInfo?.media?.landscapePath ?? null,
            backgroundPath: appInfo?.media?.backgroundPath ?? null,
            logoPath: appInfo?.media?.logoPath ?? null,
            iconPath: appInfo?.media?.iconPath ?? null,
          };
          const userData = buildUserData();
          const updatedEntry: GameAppInfo = {
            appId: appIdDraft,
            provider: appInfo?.provider ?? "steam",
            name: nameDraft || null,
            updatedAt: Math.floor(Date.now() / 1000),
            media: debridMedia,
            mediaSources: appInfo?.mediaSources ?? null,
            remote: appInfo?.remote ?? null,
            userData: Object.keys(userData).length > 0 ? userData : null,
          };
          await persistGameAppInfo(appIdDraft, updatedEntry);
          clearSessionAppInfoCache(appIdDraft);
          notifyMediaUpdated(appIdDraft);
          updateGame(appIdDraft, { title: nameDraft || undefined } as Partial<LibraryGame>);
          onMediaChanged?.();
          setAppInfo(updatedEntry);
        }

        if (ok && titleOk) {
          showSuccess(t("game_edit.save_success", "Game details saved"));
          // Calculate sizeOnDisk if installDir exists
          if (dir) {
            calculateDirectorySize(dir).then((bytes) => {
              if (bytes > 0) {
                updateGame(game?.appId ?? debridProviderGameId, { sizeOnDisk: bytes } as Partial<LibraryGame>);
              }
            }).catch(() => { });
          }
        } else if (ok) {
          showError(t("game_edit.title_save_failed", "Could not save title"));
        } else {
          showError(t("game_edit.debrid_save_failed", "Could not save debrid path"));
        }
        setHasEdits(false);
        setSaving(false);
        return;
      }

      // ── Steam game save (existing) ──
      const media: GameMediaPaths = {
        coverPath: appInfo?.media?.coverPath ?? null,
        landscapePath: appInfo?.media?.landscapePath ?? null,
        backgroundPath: appInfo?.media?.backgroundPath ?? null,
        logoPath: appInfo?.media?.logoPath ?? null,
        iconPath: appInfo?.media?.iconPath ?? null,
      };
      const userData = buildUserData();
      const updatedEntry: GameAppInfo = {
        appId: appId!,
        provider: appInfo?.provider ?? "steam",
        name: nameDraft || null,
        updatedAt: Math.floor(Date.now() / 1000),
        media,
        mediaSources: appInfo?.mediaSources ?? null,
        remote: appInfo?.remote ?? null,
        userData: Object.keys(userData).length > 0 ? userData : null,
      };
      await persistGameAppInfo(appId!, updatedEntry);
      clearSessionAppInfoCache(appId!);
      // Merge custom metadata edits into game.metadata so the detail page shows them instantly
      const metaPatch: Record<string, unknown> = {};
      if (nameDraft) metaPatch.name = nameDraft;
      if (descriptionDraft) { metaPatch.short_description = descriptionDraft; metaPatch.about_the_game = descriptionDraft; }
      if (genresDraft) metaPatch.genres = genresDraft.split(",").map((s) => s.trim()).filter(Boolean);
      if (releaseDateDraft) metaPatch.release_date = releaseDateDraft;
      if (developersDraft) metaPatch.developer = developersDraft;
      if (publishersDraft) metaPatch.publishers = publishersDraft.split(",").map((s) => s.trim()).filter(Boolean);
      if (categoriesDraft) metaPatch.categories = categoriesDraft.split(",").map((s) => s.trim()).filter(Boolean);
      if (featuresDraft) metaPatch.categories = featuresDraft.split(",").map((s) => s.trim()).filter(Boolean);
      if (seriesDraft) metaPatch.series = seriesDraft;
      if (ageRatingDraft) metaPatch.age_rating = ageRatingDraft;
      if (regionDraft) metaPatch.region = regionDraft;
      if (sortingNameDraft) metaPatch.sort_name = sortingNameDraft;
      updateGame(appId!, {
        title: nameDraft || undefined,
        completionStatus: completionStatusDraft || undefined,
        ...(Object.keys(metaPatch).length > 0 ? { metadata: { ...(game?.metadata ?? {}), ...metaPatch, resolved: true } } : {}),
      } as Partial<LibraryGame>);
      notifyMediaUpdated(appId!);
      onMediaChanged?.();
      setAppInfo(updatedEntry);
      setHasEdits(false);
      showSuccess(t("game_edit.save_success", "Game details saved"));
    } catch {
      showError(t("game_edit.save_failed", "Failed to save game details"));
    }
    setSaving(false);
  }, [appId, manualGameId, epicProviderGameId, debridProviderGameId, isManualMode, isEpicMode, isCreateMode, createdManualId, appInfo, game, nameDraft, genresDraft, developersDraft, publishersDraft, categoriesDraft, featuresDraft, tagsDraft, releaseDateDraft, descriptionDraft, sortingNameDraft, userScoreDraft, criticScoreDraft, communityScoreDraft, reviewSummaryDraft, reviewCountDraft, reviewSourceDraft, seriesDraft, ageRatingDraft, regionDraft, completionStatusDraft, executablePathDraft, workingDirectoryDraft, launchArgsDraft, installDirDraft, linkedIgdbIdDraft, appIdDraft, updateDebridGameAppId, updateDebridGamePath, updateGame, onMediaChanged]);

  // ── Track edits ──
  useEffect(() => {
    if (!open) return;
    const u = (v: unknown) => typeof v === "string" ? v : "";

    if (isManualMode || isCreateMode) {
      // Manual mode — compare against manualEntry
      const entry = manualEntry;
      const hasChanges =
        nameDraft !== (entry?.name ?? (isCreateMode ? "" : "")) ||
        genresDraft !== (entry?.genres?.join(", ") ?? "") ||
        developersDraft !== (entry?.developers?.join(", ") ?? "") ||
        publishersDraft !== (entry?.publishers?.join(", ") ?? "") ||
        categoriesDraft !== (entry?.categories?.join(", ") ?? "") ||
        featuresDraft !== (entry?.features?.join(", ") ?? "") ||
        tagsDraft !== (entry?.tags?.join(", ") ?? "") ||
        releaseDateDraft !== (entry?.releaseDate ?? "") ||
        descriptionDraft !== (entry?.description ?? "") ||
        sortingNameDraft !== (entry?.sortingName ?? "") ||
        userScoreDraft !== (entry?.userScore ?? "") ||
        criticScoreDraft !== (entry?.criticScore ?? "") ||
        communityScoreDraft !== (entry?.communityScore ?? "") ||
        reviewSummaryDraft !== (entry?.reviewSummary ?? "") ||
        reviewCountDraft !== (entry?.reviewCount ?? "") ||
        reviewSourceDraft !== (entry?.reviewSource ?? "") ||
        seriesDraft !== (entry?.series ?? "") ||
        ageRatingDraft !== (entry?.ageRating ?? "") ||
        regionDraft !== (entry?.region ?? "") ||
        completionStatusDraft !== (entry?.completionStatus ?? "") ||
        executablePathDraft !== (entry?.executablePath ?? "") ||
        workingDirectoryDraft !== (entry?.workingDirectory ?? "") ||
        launchArgsDraft !== (entry?.launchArguments ?? "") ||
        installDirDraft !== (entry?.installDir ?? "") ||
        appIdDraft !== (entry?.appId ?? "");
      setHasEdits(hasChanges || isCreateMode);
      return;
    }

    // Debrid mode — compare against current game data
    if (isDebridMode) {
      const hasChanges =
        appIdDraft !== (game?.appId ?? "") ||
        installDirDraft !== (game?.installDir ?? "") ||
        executablePathDraft !== (game?.executablePath ?? "") ||
        workingDirectoryDraft !== (game?.workingDirectory ?? "") ||
        launchArgsDraft !== (game?.launchArguments ?? "");
      setHasEdits(hasChanges);
      return;
    }

    // Epic mode — compare against Epic overrides
    if (isEpicMode && epicOverrides) {
      const eo = epicOverrides as Record<string, unknown>;
      const hasChanges =
        nameDraft !== (String(eo.name ?? "")) ||
        sortingNameDraft !== (String(eo.sortingName ?? "")) ||
        descriptionDraft !== (String(eo.description ?? "")) ||
        genresDraft !== ((eo.genres as string[] | undefined)?.join(", ") ?? "") ||
        developersDraft !== ((eo.developers as string[] | undefined)?.join(", ") ?? "") ||
        publishersDraft !== ((eo.publishers as string[] | undefined)?.join(", ") ?? "") ||
        categoriesDraft !== ((eo.categories as string[] | undefined)?.join(", ") ?? "") ||
        featuresDraft !== ((eo.features as string[] | undefined)?.join(", ") ?? "") ||
        tagsDraft !== ((eo.tags as string[] | undefined)?.join(", ") ?? "") ||
        releaseDateDraft !== (String(eo.releaseDate ?? "")) ||
        seriesDraft !== (String(eo.series ?? "")) ||
        ageRatingDraft !== (String(eo.ageRating ?? "")) ||
        regionDraft !== (String(eo.region ?? ""));
      setHasEdits(hasChanges);
      return;
    }

    // Steam mode (existing)
    const hasChanges =
      nameDraft !== (appInfo?.name ?? "") ||
      genresDraft !== u(appInfo?.userData?.genres) ||
      developersDraft !== u(appInfo?.userData?.developers) ||
      publishersDraft !== u(appInfo?.userData?.publishers) ||
      categoriesDraft !== u(appInfo?.userData?.categories) ||
      featuresDraft !== u(appInfo?.userData?.features) ||
      tagsDraft !== u(appInfo?.userData?.tags) ||
      releaseDateDraft !== u(appInfo?.userData?.releaseDate) ||
      descriptionDraft !== u(appInfo?.userData?.description) ||
      sortingNameDraft !== u(appInfo?.userData?.sortingName) ||
      userScoreDraft !== u(appInfo?.userData?.userScore) ||
      criticScoreDraft !== u(appInfo?.userData?.criticScore) ||
      communityScoreDraft !== u(appInfo?.userData?.communityScore) ||
      reviewSummaryDraft !== u(appInfo?.userData?.reviewSummary) ||
      reviewCountDraft !== u(appInfo?.userData?.reviewCount) ||
      (reviewSourceDraft ?? "") !== u(appInfo?.userData?.reviewSource) ||
      seriesDraft !== u(appInfo?.userData?.series) ||
      ageRatingDraft !== u(appInfo?.userData?.ageRating) ||
      regionDraft !== u(appInfo?.userData?.region) ||
      completionStatusDraft !== u(appInfo?.userData?.completionStatus);
    setHasEdits(hasChanges);
  }, [open, appInfo, manualEntry, epicOverrides, game, isManualMode, isEpicMode, isDebridMode, isCreateMode, nameDraft, genresDraft, developersDraft, publishersDraft, categoriesDraft, featuresDraft, tagsDraft, releaseDateDraft, descriptionDraft, sortingNameDraft, userScoreDraft, criticScoreDraft, communityScoreDraft, reviewSummaryDraft, reviewCountDraft, reviewSourceDraft, seriesDraft, ageRatingDraft, regionDraft, completionStatusDraft, executablePathDraft, workingDirectoryDraft, launchArgsDraft, installDirDraft, appIdDraft]);

  // ── Escape key ──

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // ── Build updated media object ──

  const buildUpdatedMedia = useCallback(
    (role: MediaRole, newPath: string | null): GameMediaPaths => {
      const key = ROLE_TO_PATH_KEY[role];
      if (isManualMode || isCreateMode) {
        // Read from store to avoid stale closure on manualEntry
        const targetId = manualGameId ?? createdManualId;
        const fresh = targetId ? (getManualGame(targetId) ?? manualEntry) : manualEntry;
        const current = fresh ?? ({} as ManualGameEntry);
        return {
          coverPath: current.coverPath ?? null,
          landscapePath: current.landscapePath ?? null,
          backgroundPath: current.backgroundPath ?? null,
          logoPath: current.logoPath ?? null,
          iconPath: current.iconPath ?? null,
          [key]: newPath,
        };
      }
      if (isEpicMode && epicOverrides) {
        const eo = epicOverrides as Record<string, unknown>;
        return {
          coverPath: (eo.coverPath as string) ?? null,
          landscapePath: (eo.landscapePath as string) ?? null,
          backgroundPath: (eo.backgroundPath as string) ?? null,
          logoPath: (eo.logoPath as string) ?? null,
          iconPath: (eo.iconPath as string) ?? null,
          [key]: newPath,
        };
      }
      const current = appInfo?.media ?? ({} as GameMediaPaths);
      return {
        coverPath: current.coverPath ?? null,
        landscapePath: current.landscapePath ?? null,
        backgroundPath: current.backgroundPath ?? null,
        logoPath: current.logoPath ?? null,
        iconPath: current.iconPath ?? null,
        [key]: newPath,
      };
    },
    [appInfo, manualEntry, epicOverrides, isManualMode, isCreateMode, isEpicMode, manualGameId, createdManualId],
  );

  const commitMediaUpdate = useCallback(
    async (updatedMedia: GameMediaPaths) => {
      const effectiveAppId = appId || appIdDraft;

      // ── Manual game — update ManualGameEntry ──
      if ((isManualMode || isCreateMode) && (manualGameId || createdManualId)) {
        const targetId = manualGameId ?? createdManualId!;
        const patch: Partial<ManualGameEntry> = {
          coverPath: updatedMedia.coverPath ?? undefined,
          landscapePath: updatedMedia.landscapePath ?? undefined,
          backgroundPath: updatedMedia.backgroundPath ?? undefined,
          logoPath: updatedMedia.logoPath ?? undefined,
          iconPath: updatedMedia.iconPath ?? undefined,
        };
        const updated = updateManualGame(targetId, patch);
        setManualEntry(updated);
        // When manual has appId, also persist to Steam appinfo (same as Steam path)
        if (effectiveAppId) {
          await updateGameAppinfoMediaIfChanged(
            effectiveAppId, appInfo?.name ?? null, updatedMedia,
            appInfo?.remote ?? null, appInfo?.mediaSources ?? null, "gameEditDialog",
          );
          invalidateResolvedMediaCache(effectiveAppId);
          notifyMediaUpdated(effectiveAppId);
          setAppInfo((prev) => (prev ? { ...prev, media: updatedMedia } : prev));
          updateGame(effectiveAppId, {} as Partial<LibraryGame>);
          onMediaChanged?.();
        }
        return;
      }

      // ── Epic game — update overrides store ──
      if (isEpicMode && epicProviderGameId) {
        const { writeEpicOverrides } = await import("../../services/epicOverrideStore");
        writeEpicOverrides(epicProviderGameId, {
          coverPath: updatedMedia.coverPath ?? undefined,
          landscapePath: updatedMedia.landscapePath ?? undefined,
          backgroundPath: updatedMedia.backgroundPath ?? undefined,
          logoPath: updatedMedia.logoPath ?? undefined,
          iconPath: updatedMedia.iconPath ?? undefined,
        });
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_MEDIA][EPIC_OVERRIDES_WRITTEN] providerGameId=${epicProviderGameId} roles=${Object.keys(updatedMedia).filter(k => updatedMedia[k as keyof GameMediaPaths]).join(",")}`);
        return;
      }

      // ── Steam / Debrid+appId / Manual+appId — persist to appinfo ──
      if (!effectiveAppId) return;
      await updateGameAppinfoMediaIfChanged(
        effectiveAppId,
        appInfo?.name ?? null,
        updatedMedia,
        appInfo?.remote ?? null,
        appInfo?.mediaSources ?? null,
        "gameEditDialog",
      );
      invalidateResolvedMediaCache(effectiveAppId);
      notifyMediaUpdated(effectiveAppId);
      setAppInfo((prev) => (prev ? { ...prev, media: updatedMedia } : prev));
      updateGame(effectiveAppId, {} as Partial<LibraryGame>);
      onMediaChanged?.();
    },
    [appId, appIdDraft, appInfo, updateGame, isManualMode, isCreateMode, isEpicMode, epicProviderGameId, manualGameId, createdManualId, onMediaChanged],
  );

  // ── Re-read media after web image search download ──
  const handleMediaUpdated = useCallback(async () => {
    if (isEpicMode && epicProviderGameId) {
      const overrides = readEpicOverrides(epicProviderGameId);
      if (overrides) {
        setEpicOverrides(overrides as unknown as Record<string, unknown>);
      }
    } else if (isManualMode && (manualGameId || createdManualId)) {
      const targetId = manualGameId ?? createdManualId;
      if (targetId) {
        const fresh = getManualGame(targetId);
        if (fresh) setManualEntry(fresh);
      }
    } else {
      const effectiveAppId = appId || appIdDraft;
      if (effectiveAppId) {
        const info = await getGameAppInfo(effectiveAppId);
        if (info) setAppInfo(info);
      }
    }
    // Re-resolve all previews from fresh data
    loadRolePreviews();
    // Notify parent (e.g. LibraryGameDetails) so it can re-resolve hero artwork
    onMediaChanged?.();
  }, [appId, appIdDraft, isEpicMode, epicProviderGameId, isManualMode, manualGameId, createdManualId, onMediaChanged]);

  // ── Notify library grid after web search download completes ──
  const handleDownloadComplete = useCallback(() => {
    const effectiveAppId = appId || appIdDraft;
    if (effectiveAppId) {
      updateGame(effectiveAppId, {} as Partial<LibraryGame>);
    }
    onMediaChanged?.();
  }, [appId, appIdDraft, updateGame, onMediaChanged]);

  // ── File pick handler ──

  const handleFilePick = useCallback(
    async (role: MediaRole, externalFile?: File) => {
      const input = fileInputRefs.current[role];
      const file = externalFile ?? input?.files?.[0];
      if (!file) return;

      const maxBytes = role === "icon" || role === "logo" ? SMALL_FILE_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
      if (file.size > maxBytes) {
        const limitMb = maxBytes / (1024 * 1024);
        showError(t("game_edit.file_too_large", `File too large (max {{limitMb}}MB for {{role}})`, { limitMb, role }));
        if (input) input.value = "";
        return;
      }

      setSaving(true);
      try {
        const { base64, ext } = await readFileAsBase64(file);

        if ((isManualMode || isCreateMode || isEpicMode) && mediaAdapter?.saveRoleFromBase64) {
          // Manual game — use adapter's base64 save
          const relPath = await mediaAdapter.saveRoleFromBase64(role, base64, ext);
          if (relPath) {
            const updatedMedia = buildUpdatedMedia(role, relPath);
            if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][EDITOR_SET] manualId=${manualGameId ?? createdManualId} role=${role} savedPath=${relPath} updatedMedia=${JSON.stringify(updatedMedia)}`);
            await commitMediaUpdate(updatedMedia);
            await refreshRolePreview(role, relPath);
            showSuccess(t("game_edit.role_updated_local", `{{role}} updated from local file`, { role }));
          } else {
            showError(t("game_edit.role_save_failed", `Failed to save {{role}} file`, { role }));
          }
        } else if (appId) {
          // Steam game — use existing base64 save
          const relPath = await saveGameMediaFile(appId, role, base64, ext);
          const updatedMedia = buildUpdatedMedia(role, relPath);
          await commitMediaUpdate(updatedMedia);
          await refreshRolePreview(role);
          showSuccess(t("game_edit.role_updated_local", `{{role}} updated from local file`, { role }));
        }
      } catch {
        showError(t("game_edit.role_save_failed", `Failed to save {{role}} file`, { role }));
      }
      setSaving(false);
      if (input) input.value = "";
    },
    [appId, isManualMode, isCreateMode, mediaAdapter, buildUpdatedMedia, commitMediaUpdate],
  );

  // ── URL download handler ──

  const handleUrlDownload = useCallback(
    async (role: MediaRole, urlOverride?: string) => {
      const url = urlOverride ?? urlInputs[role]?.trim();
      if (!url) return;
      if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][START] role=${role} url=${url}`);

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][VALIDATE] ok=false reason=invalid-scheme`);
        showError(t("game_edit.enter_valid_url", "Enter a valid URL (http:// or https://)"));
        return;
      }
      if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][VALIDATE] ok=true`);

      setSaving(true);
      setBrowsingRole(role);
      try {
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][DOWNLOAD_START] role=${role} url=${url}`);
        const result = mediaAdapter
          ? await mediaAdapter.saveRoleFromUrl(role, url)
          : null;
        if (result) {
          if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][DOWNLOAD_RESULT] ok=true path=${result}`);
          const updatedMedia = buildUpdatedMedia(role, result);
          await commitMediaUpdate(updatedMedia);
          if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][MANIFEST_UPDATE] role=${role} path=${result}`);
          await refreshRolePreview(role, result);
          if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][PREVIEW_UPDATE] role=${role} previewUrl=${getPreviewUrl(role)}`);
          showSuccess(t("game_edit.role_downloaded", `{{role}} downloaded`, { role }));
          setUrlInputs((prev) => ({ ...prev, [role]: "" }));
          setExpandedUrl(null);
        } else {
          if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][DOWNLOAD_RESULT] ok=false reason=rust-returned-null`);
          showError(t("game_edit.url_no_image", "URL did not return an image. The server may have rejected the request."));
        }
      } catch (err) {
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][ERROR] role=${role} error=${err instanceof Error ? err.message : String(err)}`);
        showError(t("game_edit.download_failed", "Could not download image. The server rejected the request."));
      }
      setSaving(false);
      setBrowsingRole(null);
    },
    [urlInputs, buildUpdatedMedia, commitMediaUpdate, mediaAdapter],
  );

  // ── Browse metadata source handler ──

  const handleSourcePick = useCallback(
    async (role: MediaRole, sourceId: SourceId) => {
      setBrowseOpenFor(null);
      if (sourceId === "url") {
        setExpandedUrl(role);
        return;
      }
      if (sourceId === "file") {
        fileInputRefs.current[role]?.click();
        return;
      }

      // Manual games — source handling per role
      if (isManualMode || isCreateMode) {
        if (sourceId === "local" && currentPath(role)) {
          return;
        }
        // IGDB: search by name, return only assets IGDB actually provides for this role
        if (sourceId === "igdb" && settings?.igdbClientId && settings?.igdbClientSecret) {
          const searchName = nameDraft.trim();
          if (!searchName) {
            showError(t("game_edit.enter_name_igdb", "Enter a game name first to search IGDB"));
            return;
          }
          setSaving(true);
          setBrowsingRole(role);
          try {
            const result = await fetchIgdbMetadataByName(settings.igdbClientId, settings.igdbClientSecret, searchName);
            if (!result) {
              showError(`No IGDB results found for "${searchName}"`);
            } else if (role === "cover" && result.coverUrl) {
              await handleUrlDownload(role, result.coverUrl);
            } else if ((role === "background" || role === "landscape") && result.screenshotUrls?.length) {
              // Screenshots are wide — valid for background/landscape
              await handleUrlDownload(role, result.screenshotUrls[0]);
            } else {
              showError(t("game_edit.no_igdb_candidates", `No IGDB candidates available for {{role}}. IGDB provides cover and screenshots only.`, { role }));
            }
          } catch (e) {
            showError(typeof e === "string" ? e : t("game_edit.igdb_search_failed", "Failed to search IGDB"));
          }
          setSaving(false);
          setBrowsingRole(null);
          return;
        }
        // SteamGridDB: by linked Steam App ID or by name search
        if (sourceId === "sgdb" && settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled) {
          setSaving(true);
          setBrowsingRole(role);
          try {
            const steamAppId = manualEntry?.linkedSteamAppId;
            let artwork;
            if (steamAppId) {
              // Fast path: search by Steam App ID
              const artworks = await resolveSteamGridDbArtwork([Number(steamAppId)], settings.steamGridDbApiKey);
              artwork = artworks?.find((a) => a.appId === Number(steamAppId));
            } else {
              // Name search path: search by game name, pick first result, fetch artwork
              const searchName = nameDraft.trim();
              if (!searchName) {
                showError(t("game_edit.enter_name_sgdb", "Enter a game name first to search SteamGridDB"));
                setSaving(false);
                setBrowsingRole(null);
                return;
              }
              const searchResults = await searchSteamGridDbGames(searchName, settings.steamGridDbApiKey);
              if (!searchResults?.length) {
                showError(`No SteamGridDB results found for "${searchName}"`);
                setSaving(false);
                setBrowsingRole(null);
                return;
              }
              const bestMatch = searchResults[0];
              artwork = await resolveSteamGridDbArtworkByGameId(bestMatch.sgdbGameId, settings.steamGridDbApiKey);
              // Map SGDB internal ID into artwork result (app_id is used only as identifier)
              if (artwork) artwork = { ...artwork, appId: bestMatch.sgdbGameId };
            }
            if (artwork) {
              // Strict role mapping — each role maps to its own SGDB asset type
              let downloadUrl: string | null = null;
              if (role === "cover") downloadUrl = artwork.gridUrl ?? null;
              else if (role === "landscape") downloadUrl = artwork.gridHorizontalUrl ?? null;
              else if (role === "background") downloadUrl = artwork.heroUrl ?? null;
              else if (role === "logo") downloadUrl = artwork.logoUrl ?? null;
              else if (role === "icon") downloadUrl = artwork.iconUrl ?? null;
              if (downloadUrl) {
                await handleUrlDownload(role, downloadUrl);
              } else {
                showError(t("game_edit.no_sgdb_role_art", `No SteamGridDB {{role}} art available for this game`, { role }));
              }
            } else {
              showError(t("game_edit.no_sgdb_results", "No SteamGridDB results found"));
            }
          } catch (e) {
            const msg = typeof e === "string" ? e : String(e ?? "Failed to search SteamGridDB");
            // Never show raw HTML in toast
            if (/<html/i.test(msg)) {
              showError(t("game_edit.sgdb_search_failed", "SteamGridDB search failed. Check API key or endpoint."));
            } else {
              showError(msg);
            }
          }
          setSaving(false);
          setBrowsingRole(null);
          return;
        }
        // Steam Official: requires linked Steam App ID
        if (sourceId === "steam") {
          const steamAppId = manualEntry?.linkedSteamAppId || manualEntry?.appId || appIdDraft;
          if (!steamAppId) {
            showError(t("game_edit.link_steam_first", "Link a Steam App ID first to use Steam Official Assets"));
            return;
          }
          setSaving(true);
          setBrowsingRole(role);
          try {
            const metaMap = await resolveGameMetadata([Number(steamAppId)]);
            const meta = metaMap[Number(steamAppId)];
            if (meta) {
            const steamUrlMap: Record<MediaRole, string | null> = {
              icon: null,
              cover: buildSteamOfficialUrl(steamAppId, "cover"),
              landscape: buildSteamOfficialUrl(steamAppId, "landscape"),
              background: buildSteamOfficialUrl(steamAppId, "background"),
              logo: buildSteamOfficialUrl(steamAppId, "logo"),
            };
              const downloadUrl = steamUrlMap[role] ?? null;
              if (downloadUrl) {
                await handleUrlDownload(role, downloadUrl);
              } else {
                showError(t("game_edit.no_steam_role_art", `No Steam official {{role}} art available for this game`, { role }));
              }
            } else {
              showError(t("game_edit.no_steam_metadata_game", "No Steam metadata available for this game"));
            }
          } catch {
            showError(t("game_edit.fetch_steam_failed", "Failed to fetch Steam assets"));
          }
          setSaving(false);
          setBrowsingRole(null);
          return;
        }
        return; // All manual sources handled above
      }

      // ── Epic games — name-based search for SGDB/IGDB, no Steam CDN ──
      if (isEpicMode) {
        if (sourceId === "sgdb" && settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled) {
          setSaving(true);
          setBrowsingRole(role);
          try {
            const searchName = nameDraft.trim();
            if (!searchName) {
              showError(t("game_edit.enter_name_sgdb", "Enter a game name first to search SteamGridDB"));
              setSaving(false);
              setBrowsingRole(null);
              return;
            }
            const { searchSteamGridDbGames, resolveSteamGridDbArtworkByGameId } = await import("../../services/tauri");
            const searchResults = await searchSteamGridDbGames(searchName, settings.steamGridDbApiKey);
            if (!searchResults?.length) {
              showError(`No SteamGridDB results found for "${searchName}"`);
              setSaving(false);
              setBrowsingRole(null);
              return;
            }
            const bestMatch = searchResults[0];
            const artwork = await resolveSteamGridDbArtworkByGameId(bestMatch.sgdbGameId, settings.steamGridDbApiKey);
            if (artwork) {
              let downloadUrl: string | null = null;
              if (role === "cover") downloadUrl = artwork.gridUrl ?? null;
              else if (role === "landscape") downloadUrl = artwork.gridHorizontalUrl ?? null;
              else if (role === "background") downloadUrl = artwork.heroUrl ?? null;
              else if (role === "logo") downloadUrl = artwork.logoUrl ?? null;
              else if (role === "icon") downloadUrl = artwork.iconUrl ?? null;
              if (downloadUrl) {
                await handleUrlDownload(role, downloadUrl);
              } else {
                showError(t("game_edit.no_sgdb_role_art", `No SteamGridDB {{role}} art available for this game`, { role }));
              }
            } else {
              showError(t("game_edit.no_sgdb_results", "No SteamGridDB results found"));
            }
          } catch (e) {
            const msg = typeof e === "string" ? e : String(e ?? "Failed to search SteamGridDB");
            if (/<html/i.test(msg)) {
              showError(t("game_edit.sgdb_search_failed", "SteamGridDB search failed. Check API key or endpoint."));
            } else {
              showError(msg);
            }
          }
          setSaving(false);
          setBrowsingRole(null);
          return;
        }
        if (sourceId === "igdb" && settings?.igdbClientId && settings?.igdbClientSecret) {
          const searchName = nameDraft.trim();
          if (!searchName) {
            showError(t("game_edit.enter_name_igdb", "Enter a game name first to search IGDB"));
            return;
          }
          setSaving(true);
          setBrowsingRole(role);
          try {
            const { fetchIgdbMetadataByName } = await import("../../services/storeArtworkResolver");
            const result = await fetchIgdbMetadataByName(settings.igdbClientId, settings.igdbClientSecret, searchName);
            if (!result) {
              showError(`No IGDB results found for "${searchName}"`);
            } else if (role === "cover" && result.coverUrl) {
              await handleUrlDownload(role, result.coverUrl);
            } else if ((role === "background" || role === "landscape") && result.screenshotUrls?.length) {
              await handleUrlDownload(role, result.screenshotUrls[0]);
            } else {
              showError(t("game_edit.no_igdb_candidates", `No IGDB candidates available for {{role}}. IGDB provides cover and screenshots only.`, { role }));
            }
          } catch (e) {
            showError(typeof e === "string" ? e : t("game_edit.igdb_search_failed", "Failed to search IGDB"));
          }
          setSaving(false);
          setBrowsingRole(null);
          return;
        }
        showError(`Source "${sourceId}" is not available for Epic games`);
        return;
      }

      const effectiveSteamAppId = appId || appIdDraft;
      if (!effectiveSteamAppId) return;

      setSaving(true);
      setBrowsingRole(role);
      try {
        let downloadUrl: string | null = null;

        if (sourceId === "steam") {
          // Resolve metadata inline if not already loaded (same as Manual handler)
          if (!metadata) {
            const metaMap = await resolveGameMetadata([Number(effectiveSteamAppId)]);
            const meta = metaMap[Number(effectiveSteamAppId)];
            if (meta) {
              setMetadata(meta);
              fillDraftsFromMetadata(meta);
            }
          }
          const steamUrlMap: Record<MediaRole, string | null> = {
            icon: null,
            cover: buildSteamOfficialUrl(effectiveSteamAppId, "cover"),
            landscape: buildSteamOfficialUrl(effectiveSteamAppId, "landscape"),
            background: buildSteamOfficialUrl(effectiveSteamAppId, "background"),
            logo: buildSteamOfficialUrl(effectiveSteamAppId, "logo"),
          };
          downloadUrl = steamUrlMap[role] ?? null;
        } else if (sourceId === "sgdb" && settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled) {
          try {
            const artworks = await resolveSteamGridDbArtwork([Number(effectiveSteamAppId)], settings.steamGridDbApiKey);
            const artwork = artworks?.find((a) => a.appId === Number(effectiveSteamAppId));
            if (artwork) {
              if (role === "cover") downloadUrl = artwork.gridUrl ?? null;
              else if (role === "landscape") downloadUrl = artwork.gridHorizontalUrl ?? null;
              else if (role === "background") downloadUrl = artwork.heroUrl ?? null;
              else if (role === "logo") downloadUrl = artwork.logoUrl ?? null;
              else if (role === "icon") downloadUrl = artwork.iconUrl ?? null;
            }
          } catch { /* SGDB failed */ }
        } else if (sourceId === "igdb" && settings?.igdbClientId && settings?.igdbClientSecret) {
          try {
            const igdbData = await fetchIgdbArtworkDeduped({
              clientId: settings.igdbClientId,
              clientSecret: settings.igdbClientSecret,
              appId: effectiveSteamAppId,
            });
            if (igdbData?.igdbCoverUrl && (role === "cover" || role === "landscape")) {
              downloadUrl = igdbData.igdbCoverUrl;
            }
          } catch { /* IGDB failed */ }
        } else if (sourceId === "rawg" && settings?.rawgApiKey) {
          try {
            const rawgData = await fetchRawgArtworkDeduped({
              apiKey: settings.rawgApiKey,
              appId: effectiveSteamAppId,
            });
            if (rawgData?.rawgBackgroundUrl && (role === "background" || role === "landscape")) {
              downloadUrl = rawgData.rawgBackgroundUrl;
            }
          } catch { /* RAWG failed */ }
        }

        if (downloadUrl) {
          await handleUrlDownload(role, downloadUrl);
        } else {
          showError(t("game_edit.no_source_available", `No {{source}} source available for {{role}}`, { source: sourceId, role }));
        }
      } catch {
        showError(t("game_edit.get_source_failed", `Failed to get {{source}} source`, { source: sourceId }));
      }
      setSaving(false);
      setBrowsingRole(null);
    },
    [appId, appIdDraft, metadata, settings, handleUrlDownload, isManualMode, isCreateMode, isEpicMode, nameDraft, manualEntry?.linkedSteamAppId],
  );

  const handleOpenImageSearch = useCallback((role: MediaRole) => {
    setBrowseOpenFor(null);
    lastImageSearchRoleRef.current = role;
    setImageSearchRole(role);
    setImageSearchOpen(true);
  }, []);

  // ── Remove handler ──

  const handleRemove = useCallback(
    async (role: MediaRole) => {
      setSaving(true);
      try {
        if (mediaAdapter) {
          await mediaAdapter.removeRole(role);
        }
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_MEDIA][FILE_DELETED] appid=${effectiveId} role=${role}`);
        const updatedMedia = buildUpdatedMedia(role, null);
        if (DEBUG_MANUAL_COVER) console.log(`[MANUAL_COVER][EDITOR_SET] manualId=${manualGameId ?? createdManualId} role=${role} savedPath=null (removing) updatedMedia=${JSON.stringify(updatedMedia)}`);
        await commitMediaUpdate(updatedMedia);
        // Re-read from store to ensure consistency
        const targetId = manualGameId ?? createdManualId;
        if (targetId) {
          const freshEntry = getManualGame(targetId);
          if (freshEntry) setManualEntry(freshEntry);
        }
        await refreshRolePreview(role, null);
        showSuccess(t("game_edit.role_removed", `{{role}} removed`, { role }));
      } catch {
        showError(t("game_edit.role_remove_failed", `Failed to remove {{role}}`, { role }));
      }
      setSaving(false);
    },
    [effectiveId, buildUpdatedMedia, commitMediaUpdate, mediaAdapter, manualGameId, createdManualId],
  );

  // ── Role preview resolution ──

  async function loadRolePreviews() {
    setRolePreviews({});
    // Manual game WITHOUT appId → read from manual store
    if ((isManualMode || isCreateMode) && (manualGameId ?? createdManualId) && !appIdDraft) {
      const targetId = manualGameId ?? createdManualId!;
      const freshEntry = getManualGame(targetId) ?? manualEntry;
      if (!freshEntry) return;
      const previews: Record<string, RolePreviewEntry> = {};
      for (const { role } of MEDIA_ROLES) {
        const key = ROLE_TO_PATH_KEY[role] as keyof ManualGameEntry;
        const relPath = freshEntry[key] as string | undefined;
        if (relPath) {
          const url = await resolveProviderMediaPreviewUrl(relPath);
          previews[role] = { url, status: url ? "set" : "missing" };
        } else {
          previews[role] = { url: null, status: "unset" };
        }
      }
      setRolePreviews(previews);
      return;
    }
    // Epic game → read from epicOverrides
    if (isEpicMode && epicOverrides) {
      const eo = epicOverrides as Record<string, unknown>;
      const previews: Record<string, RolePreviewEntry> = {};
      for (const { role } of MEDIA_ROLES) {
        const key = ROLE_TO_PATH_KEY[role];
        const relPath = eo[key] as string | undefined;
        if (relPath) {
          const url = await resolveProviderMediaPreviewUrl(relPath);
          previews[role] = { url, status: url ? "set" : "missing" };
        } else {
          previews[role] = { url: null, status: "unset" };
        }
      }
      setRolePreviews(previews);
      return;
    }
    // Steam, Debrid+appId → use mediaAdapter
    if (!mediaAdapter) return;
    const states = await mediaAdapter.getAllRoleStates();
    const previews: Record<string, RolePreviewEntry> = {};
    for (const { role } of MEDIA_ROLES) {
      const state = states[role];
      const key = ROLE_TO_PATH_KEY[role];
      if (state.hasFile && state.previewUrl) {
        previews[role] = { url: state.previewUrl, status: "set" };
      } else {
        const appPath = appInfo?.media?.[key];
        previews[role] = { url: null, status: appPath ? "missing" : "unset" };
      }
    }
    setRolePreviews(previews);
  }

  async function refreshRolePreview(role: MediaRole, overrideRelPath?: string | null) {
    // Manual WITHOUT appId → read from manual store; Manual WITH appId → falls through to mediaAdapter
    if ((isManualMode || isCreateMode) && (manualGameId ?? createdManualId) && !appIdDraft) {
      const targetId = manualGameId ?? createdManualId!;
      const freshEntry = getManualGame(targetId) ?? manualEntry;
      const key = ROLE_TO_PATH_KEY[role] as keyof ManualGameEntry;
      // overrideRelPath=undefined means "read from store"; null means "force unset"
      let relPath: string | undefined;
      if (overrideRelPath === null) {
        relPath = undefined;
      } else if (overrideRelPath !== undefined) {
        relPath = overrideRelPath;
      } else {
        relPath = freshEntry?.[key] as string | undefined;
      }
      if (relPath) {
        const url = await resolveProviderMediaPreviewUrl(relPath);
        setRolePreviews((prev) => ({
          ...prev,
          [role]: { url, status: url ? "set" : "missing" },
        }));
      } else {
        setRolePreviews((prev) => ({
          ...prev,
          [role]: { url: null, status: "unset" },
        }));
      }
      return;
    }
    // Epic game → read from epicOverrides
    if (isEpicMode && epicOverrides) {
      const eo = epicOverrides as Record<string, unknown>;
      const key = ROLE_TO_PATH_KEY[role];
      let relPath: string | undefined;
      if (overrideRelPath === null) {
        relPath = undefined;
      } else if (overrideRelPath !== undefined) {
        relPath = overrideRelPath;
      } else {
        relPath = eo[key] as string | undefined;
      }
      if (relPath) {
        const url = await resolveProviderMediaPreviewUrl(relPath);
        setRolePreviews((prev) => ({
          ...prev,
          [role]: { url, status: url ? "set" : "missing" },
        }));
      } else {
        setRolePreviews((prev) => ({
          ...prev,
          [role]: { url: null, status: "unset" },
        }));
      }
      return;
    }
    if (!mediaAdapter) return;
    const state = await mediaAdapter.getRoleState(role);
    const key = ROLE_TO_PATH_KEY[role];
    if (state.hasFile && state.previewUrl) {
      setRolePreviews((prev) => ({
        ...prev,
        [role]: { url: state.previewUrl ?? null, status: "set" },
      }));
    } else {
      const appPath = appInfo?.media?.[key];
      setRolePreviews((prev) => ({
        ...prev,
        [role]: { url: null, status: appPath ? "missing" : "unset" },
      }));
    }
  }

  function getPreviewStatus(role: MediaRole): RolePreviewStatus {
    return rolePreviews[role]?.status ?? "loading";
  }

  function getPreviewUrl(role: MediaRole): string | null {
    return rolePreviews[role]?.url ?? null;
  }

  // ── Source availability checks ──

  // ── Provider capabilities (manual vs Steam) ──
  const capabilities = useMemo(() => {
    if (isManualMode || isCreateMode) {
      const hasSgdbKey = !!(settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled);
      const hasLinkedSteam = !!(manualEntry?.linkedSteamAppId || manualEntry?.appId || appIdDraft);
      return {
        canUseMetadataProviders: true,
        canUseSteamMetadata: true,
        canUseIgdbMetadata: !!(settings?.igdbClientId && settings?.igdbClientSecret),
        canUseRawgMetadata: false,
        canUseSteamAssets: hasLinkedSteam,
        canUseIgdbAssets: !!(settings?.igdbClientId && settings?.igdbClientSecret),
        canUseSgdbAssets: hasSgdbKey,
        canUseRawgAssets: false,
      };
    }
    const hasSteamAppId = !!(appId || appIdDraft);
    return {
      canUseMetadataProviders: true,
      canUseSteamMetadata: true,
      canUseIgdbMetadata: !!(settings?.igdbClientId && settings?.igdbClientSecret),
      canUseRawgMetadata: !!(settings?.rawgApiKey),
      canUseSteamAssets: hasSteamAppId || !!(metadata?.capsule_image || metadata?.header_image || metadata?.library_hero_image || metadata?.library_logo_image),
      canUseIgdbAssets: !!(settings?.igdbClientId && settings?.igdbClientSecret),
      canUseSgdbAssets: !!(settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled),
      canUseRawgAssets: !!(settings?.rawgApiKey),
    };
  }, [settings, metadata, isManualMode, isCreateMode, manualEntry?.linkedSteamAppId, manualEntry?.appId, appId, appIdDraft]);

  const sourceAvailability = useMemo(() => ({
    sgdb: capabilities.canUseSgdbAssets,
    igdb: capabilities.canUseIgdbAssets,
    rawg: capabilities.canUseRawgAssets,
    steam: capabilities.canUseSteamAssets,
  }), [capabilities]);

  if (!open) return null;

  const currentPath = (role: MediaRole): string | null => {
    const key = ROLE_TO_PATH_KEY[role];
    // Manual game (with or without appId) → read from manual store
    if ((isManualMode || isCreateMode) && manualEntry) {
      return (manualEntry[key as keyof ManualGameEntry] as string) ?? null;
    }
    // Epic game → read from epicOverrides
    if (isEpicMode && epicOverrides) {
      const eo = epicOverrides as Record<string, unknown>;
      return (eo[key] as string) ?? null;
    }
    // Steam, Debrid+appId → read from appInfo (Steam appinfo)
    return appInfo?.media?.[key] ?? null;
  };

  // ── Tab content renderers ──

  function renderGeneralTab() {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Left column - Identity & Credits */}
          <div className="space-y-4">
            <EditableField
              label={t("game_edit.field_name", "Name")}
              value={nameDraft}
              onChange={setNameDraft}
              placeholder={t("game_edit.field_name_placeholder", "Enter game name")}
              maxLength={128}
            />
            <EditableField
              label={t("game_edit.field_genres", "Genres")}
              value={genresDraft}
              onChange={setGenresDraft}
              placeholder={t("game_edit.field_genres_placeholder", "Action, Adventure, RPG (comma-separated)")}
            />
            <EditableField
              label={t("game_edit.field_developer", "Developer")}
              value={developersDraft}
              onChange={setDevelopersDraft}
              placeholder={t("game_edit.field_developer_placeholder", "Developer name")}
            />
            <EditableField
              label={t("game_edit.field_publishers", "Publishers")}
              value={publishersDraft}
              onChange={setPublishersDraft}
              placeholder={t("game_edit.field_publishers_placeholder", "Publisher name (comma-separated)")}
            />
          </div>

          {/* Right column - Classification & Metadata */}
          <div className="space-y-4">
            <EditableField
              label={t("game_edit.field_release_date", "Release Date")}
              value={releaseDateDraft}
              onChange={setReleaseDateDraft}
              placeholder="e.g. Jan 15, 2024"
            />
            <EditableField
              label={t("game_edit.field_categories", "Categories")}
              value={categoriesDraft}
              onChange={setCategoriesDraft}
              placeholder={t("game_edit.field_categories_placeholder", "Single-player, Multi-player (comma-separated)")}
            />
            <FieldRow label={t("game_edit.field_source", "Source")} value={isManualMode || isCreateMode ? "manual" : (game?.source ?? appInfo?.provider ?? (metadata ? "steam" : null))} />
            <div>
              <label className="mb-1 block text-xs font-medium text-(--color-muted)">Steam App ID</label>
              <input
                type="text"
                value={appIdDraft}
                onChange={(e) => setAppIdDraft(e.target.value)}
                disabled={!isManualMode && !isDebridMode && !isCreateMode}
                placeholder="Ej: 12210"
                className={`w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20 ${!isManualMode && !isDebridMode && !isCreateMode ? "opacity-60 cursor-not-allowed" : ""}`}
              />
              {(isManualMode || isDebridMode) && (
                <p className="mt-1 text-[11px] text-white/40">
                  {t("game_edit.appid_hint", "Set to auto-resolve media & metadata from Steam")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <EditableField
            label={t("game_edit.field_description", "Description")}
            value={descriptionDraft}
            onChange={setDescriptionDraft}
            placeholder={t("game_edit.field_description_placeholder", "Game description...")}
            multiLine
            maxLength={4000}
          />
        </div>
      </div>
    );
  }

  function renderInfoTab() {
    const hasId = !!appId || !!effectiveId;
    const scripts = game?.luaScripts ?? [];

    // External links
    const links: { label: string; url: string; icon: typeof Globe }[] = [];
    const appIdNum = Number(appId);
    if (appId && !isNaN(appIdNum)) {
      links.push({ label: t("game_edit.link_steam", "Steam Store"), url: `https://store.steampowered.com/app/${appIdNum}`, icon: Globe });
      links.push({ label: t("game_edit.link_steamdb", "SteamDB"), url: `https://steamdb.info/app/${appIdNum}`, icon: ExternalLink });
      links.push({ label: t("game_edit.link_protondb", "ProtonDB"), url: `https://www.protondb.com/app/${appIdNum}`, icon: ExternalLink });
      links.push({ label: t("game_edit.link_steamgriddb", "SteamGridDB"), url: `https://www.steamgriddb.com/search?q=${encodeURIComponent(appInfo?.name ?? appId)}`, icon: ExternalLink });
      links.push({ label: t("game_edit.link_pcgamingwiki", "PCGamingWiki"), url: `https://www.pcgamingwiki.com/api/appid.php?appid=${appIdNum}`, icon: ExternalLink });
    }

    // Action buttons
    const actionButtons: { label: string; icon: typeof FolderOpen; onClick: () => void; disabled?: boolean }[] = [
      {
        label: t("game_edit.action_open_metadata", "Open Metadata Folder"),
        icon: FolderOpen,
        onClick: () => { if (effectiveId) openGameMetadataFolder(effectiveId); onClose(); },
        disabled: !hasId,
      },
      {
        label: t("game_edit.action_open_media", "Open Media Folder"),
        icon: FolderOpen,
        onClick: () => {
          if (isManualMode && manualGameId) { openProviderMediaFolder("manual", manualGameId); }
          else if (isEpicMode && epicProviderGameId) { openProviderMediaFolder("epic", epicProviderGameId); }
          else if (effectiveId) { openGameMediaFolder(effectiveId); }
          onClose();
        },
        disabled: !hasId,
      },
      ...(!isManualMode && !isCreateMode && appId ? [{
        label: t("game_edit.action_refresh_art", "Refresh Artwork"),
        icon: RefreshCw,
        onClick: async () => {
          try {
            await refreshGameDetailsArtwork(
              appId,
              appInfo?.media ?? null,
              metadata,
              null,
              null,
              {
                sgdbApiKey: settings?.steamGridDbApiKey ?? "",
                sgdbEnabled: !!(settings?.steamGridDbArtworkEnabled && settings?.steamGridDbApiKey),
                rawgApiKey: settings?.rawgApiKey ?? "",
                useRawg: !!settings?.rawgApiKey,
              },
            );
            invalidateResolvedMediaCache(appId);
            notifyMediaUpdated(appId);
            showSuccess(t("game_edit.artwork_refreshed", "Artwork refresh triggered"));
            onClose();
          } catch {
            showError(t("game_edit.artwork_refresh_failed", "Artwork refresh failed"));
          }
        },
        disabled: false,
      }] : []),
      {
        label: t("game_edit.action_copy_appid", "Copy App ID"),
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(effectiveId).catch(() => {});
          showSuccess(t("game_edit.appid_copied", "App ID copied"));
        },
        disabled: !hasId,
      },
      ...(!isManualMode && !isCreateMode && appId ? [{
        label: t("game_edit.action_open_steam", "Open Steam Page"),
        icon: Globe,
        onClick: () => {
          window.open(`https://store.steampowered.com/app/${appId}`, "_blank");
          onClose();
        },
        disabled: false,
      }] : []),
    ];

    return (
      <div className="space-y-6">
        {/* ── Game Information (metadata) ── */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">{t("game_edit.game_info", "Game Information")}</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-(--color-muted)">{t("game_edit.completion_status", "Completion Status")}</label>
                <div className="flex gap-1.5 rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-1">
                  {[
                    { value: "", label: t("game_edit.status_auto", "Auto") },
                    { value: "completed", label: t("game_edit.status_completed", "Completed") },
                    { value: "in-progress", label: t("game_edit.status_in_progress", "In Progress") },
                    { value: "not-played", label: t("game_edit.status_not_played", "Not Played") },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setCompletionStatusDraft(opt.value); setHasEdits(true); }}
                      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        completionStatusDraft === opt.value
                          ? "bg-(--color-accent)/20 text-(--color-accent)"
                          : "text-(--color-muted) hover:bg-white/5 hover:text-(--color-text)"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-(--color-muted)/60">
                  {t("game_edit.auto_derives", "Auto derives from playtime & achievements.")}
                </p>
              </div>
              {metadata?.platforms?.length ? (
                <FieldRow label={t("game_edit.field_platforms", "Platforms")} value={metadata.platforms.join(", ")} />
              ) : null}
              {metadata?.languages?.length ? (
                <FieldRow label={t("game_edit.field_languages", "Languages")} value={metadata.languages.join(", ")} />
              ) : null}
            </div>
            <div className="space-y-3">
              {metadata?.dlc_count != null && metadata.dlc_count > 0 && (
                <FieldRow label={t("game_edit.field_dlc_count", "DLC Count")} value={String(metadata.dlc_count)} />
              )}
              {metadata?.legal_notice && (
                <FieldRow label={t("game_edit.field_legal_notice", "Legal Notice")} value={metadata.legal_notice} />
              )}
              {metadata?.store_drm_notice && (
                <FieldRow label={t("game_edit.field_drm_notice", "DRM Notice")} value={metadata.store_drm_notice} />
              )}
            </div>
          </div>
        </div>

        {/* ── Lua Scripts ── */}
        {scripts.length > 0 && (
          <div className="border-t border-(--color-border) pt-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">{t("game_edit.lua_scripts", "Lua Scripts")}</h4>
            <FieldRow label={t("game_edit.has_lua_scripts", "Has Lua Scripts")} value={game?.hasLua ? t("game_edit.yes", "Yes") : t("game_edit.no", "No")} />
            <FieldRow label={t("game_edit.field_active", "Active")} value={game?.isLuaActive ? t("game_edit.active", "Active") : t("game_edit.inactive", "Inactive")} />
            <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
              {scripts.map((s: { name?: string; path?: string }, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-3 py-2">
                  <Code className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
                  <span className="truncate text-xs text-(--color-text)">{s.name ?? s.path ?? `Script ${i + 1}`}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── External Links ── */}
        {links.length > 0 && (
          <div className="border-t border-(--color-border) pt-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">{t("game_edit.external_links", "External Links")}</h4>
            <div className="space-y-2">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                >
                  <link.icon className="h-4 w-4 text-(--color-accent)" />
                  <span className="flex-1">{link.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-(--color-muted)" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="border-t border-(--color-border) pt-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">{t("game_edit.actions", "Actions")}</h4>
          <div className="space-y-2">
            {actionButtons.map((btn) => (
              <button
                key={btn.label}
                type="button"
                onClick={btn.onClick}
                disabled={btn.disabled}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <btn.icon className="h-4 w-4 text-(--color-muted)" />
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderInstallationTab() {
    const isManual = isManualMode || isCreateMode;
    const isDebridInstall = isDebridMode && debridProviderGameId;
    const hasExe = !!executablePathDraft.trim();

    return (
      <div className="space-y-5">
        {isDebridInstall ? (
          <>
            {/* ── Section: Game Configuration ── */}
            <div>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
                Game Configuration
              </h4>
              <div className="space-y-4">
                {/* Executable Path */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Executable Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={executablePathDraft}
                      onChange={(e) => {
                        setExecutablePathDraft(e.target.value);
                        if (!installDirDraft.trim() && !workingDirectoryDraft.trim()) {
                          const parent = e.target.value.replace(/[\\/][^/\\]+$/, "");
                          if (parent) { setInstallDirDraft(parent); setWorkingDirectoryDraft(parent); }
                        }
                        setHasEdits(true);
                      }}
                      placeholder="C:\Path\To\Game.exe"
                      className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                    />
                    <button
                      type="button"
                      onClick={handleBrowseExe}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  {hasExe && !executablePathDraft.trim().includes("/") && !executablePathDraft.trim().includes("\\") && (
                    <p className="mt-1 text-[11px] text-amber-400">
                      {t("game_edit.warning_bare_filename", "Warning: This looks like a bare filename. Use Browse to select the full path so the game can launch.")}
                    </p>
                  )}
                </div>

                {/* Working Directory */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Working Directory
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={workingDirectoryDraft}
                      onChange={(e) => { setWorkingDirectoryDraft(e.target.value); setHasEdits(true); }}
                      placeholder="C:\Path\To\Game"
                      className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const folder = await pickFolder(t("game_edit.select_working_dir", "Select Working Directory"), workingDirectoryDraft.trim() || undefined);
                        if (folder) { setWorkingDirectoryDraft(folder); setHasEdits(true); }
                      }}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-(--color-muted)/60">
                    {t("game_edit.auto_fill_hint", "Auto-filled to executable parent folder if empty.")}
                  </p>
                </div>

                {/* Launch Arguments */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Launch Arguments
                  </label>
                  <input
                    type="text"
                    value={launchArgsDraft}
                    onChange={(e) => { setLaunchArgsDraft(e.target.value); setHasEdits(true); }}
                    placeholder="-windowed -noborder"
                    className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                  />
                </div>

                {/* Install Folder */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Install Folder
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={installDirDraft}
                      onChange={(e) => { setInstallDirDraft(e.target.value); setHasEdits(true); }}
                      placeholder="C:\Games\My Game"
                      className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const folder = await pickFolder(t("game_edit.select_install_folder", "Select Install Folder"), installDirDraft.trim() || undefined);
                        if (folder) { setInstallDirDraft(folder); setHasEdits(true); }
                      }}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-(--color-muted)/60">
                    {t("game_edit.auto_fill_hint", "Auto-filled to executable parent folder if empty.")}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Section: Install Info ── */}
            <div className="border-t border-(--color-border) pt-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
                Install Info
              </h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Steam App ID</span>
                  <span className="text-xs text-(--color-muted)">{appId ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Installed</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${hasExe ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"}`}>
                    {hasExe ? t("game_edit.yes", "Yes") : t("game_edit.not_configured", "Not configured")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Install Size</span>
                  <span className="text-xs text-(--color-muted)">
                    {game?.sizeOnDisk ? formatBytes(game.sizeOnDisk) : t("game_edit.calculation_unavailable", "Calculation not available yet")}
                  </span>
                </div>
                {(installDirDraft.trim() || hasExe) && (
                  <button
                    type="button"
                    onClick={handleOpenInstallFolder}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                  >
                    <FolderOpen className="h-4 w-4 text-(--color-muted)" />
                    Open Install Folder
                  </button>
                )}
              </div>
            </div>
          </>
        ) : isManual ? (
          <>
            {/* ── Section: Game Configuration ── */}
            <div>
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
                Game Configuration
              </h4>
              <div className="space-y-4">
                {/* Executable Path */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Executable Path <span className="text-rose-400">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={executablePathDraft}
                      onChange={(e) => { setExecutablePathDraft(e.target.value); setHasEdits(true); }}
                      placeholder="C:\Path\To\Game.exe"
                      className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                    />
                    <button
                      type="button"
                      onClick={handleBrowseExe}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  {executablePathDraft.trim() && !executablePathDraft.trim().includes("/") && !executablePathDraft.trim().includes("\\") && (
                    <p className="mt-1 text-[11px] text-amber-400">
                      {t("game_edit.warning_bare_filename", "Warning: This looks like a bare filename. Use Browse to select the full path so the game can launch.")}
                    </p>
                  )}
                </div>

                {/* Working Directory */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Working Directory
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={workingDirectoryDraft}
                      onChange={(e) => { setWorkingDirectoryDraft(e.target.value); setHasEdits(true); }}
                      placeholder="C:\Path\To\Game"
                      className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const folder = await pickFolder(t("game_edit.select_working_dir", "Select Working Directory"), workingDirectoryDraft.trim() || undefined);
                        if (folder) { setWorkingDirectoryDraft(folder); setHasEdits(true); }
                      }}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-(--color-muted)/60">
                    {t("game_edit.auto_fill_hint", "Auto-filled to executable parent folder if empty.")}
                  </p>
                </div>

                {/* Launch Arguments */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Launch Arguments
                  </label>
                  <input
                    type="text"
                    value={launchArgsDraft}
                    onChange={(e) => { setLaunchArgsDraft(e.target.value); setHasEdits(true); }}
                    placeholder="-windowed -noborder"
                    className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                  />
                </div>

                {/* Install Folder */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--color-muted)">
                    Install Folder
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={installDirDraft}
                      onChange={(e) => { setInstallDirDraft(e.target.value); setHasEdits(true); }}
                      placeholder="C:\Games\My Game"
                      className="flex-1 rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const folder = await pickFolder(t("game_edit.select_install_folder", "Select Install Folder"), installDirDraft.trim() || undefined);
                        if (folder) { setInstallDirDraft(folder); setHasEdits(true); }
                      }}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-(--color-muted)/60">
                    {t("game_edit.auto_fill_hint", "Auto-filled to executable parent folder if empty.")}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Section: Install Info ── */}
            <div className="border-t border-(--color-border) pt-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
                Install Info
              </h4>
              <div className="space-y-3">
                {/* Steam App ID */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Steam App ID</span>
                  <span className="text-xs text-(--color-muted)">{appIdDraft || "—"}</span>
                </div>

                {/* Installed state */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Installed</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${hasExe ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"}`}>
                    {hasExe ? t("game_edit.yes", "Yes") : t("game_edit.not_configured", "Not configured")}
                  </span>
                </div>

                {/* Size on Disk */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Install Size</span>
                  <span className="text-xs text-(--color-muted)">
                    {game?.sizeOnDisk ? formatBytes(game.sizeOnDisk) : t("game_edit.calculation_unavailable", "Calculation not available yet")}
                  </span>
                </div>

                {/* Open Install Folder */}
                {installDirDraft.trim() && (
                  <button
                    type="button"
                    onClick={handleOpenInstallFolder}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                  >
                    <FolderOpen className="h-4 w-4 text-(--color-muted)" />
                    Open Install Folder
                  </button>
                )}
              </div>
            </div>

            {/* ── Section: Additional Launch Entries (placeholder) ── */}
            <div className="border-t border-(--color-border) pt-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">
                Additional Launch Entries
              </h4>
              <div className="rounded-xl border border-dashed border-(--surface-active-border) bg-white/[0.01] px-4 py-6 text-center">
                <p className="text-xs text-(--color-muted)/60">
                  {t("game_edit.additional_launch_hint", "Additional launch entries will be available later.")}
                </p>
              </div>
            </div>

            {isCreateMode && !hasExe && (
              <p className="rounded-xl bg-white/[0.02] px-4 py-3 text-xs text-(--color-muted)/70">
                {t("game_edit.configure_exe_hint", "Configure at least an executable path to mark this game as installed.")}
              </p>
            )}
          </>
        ) : (
          <>
            {/* ── Steam game: read-only install info ── */}
            <div className="space-y-4">
              <FieldRow label={t("game_edit.field_appid", "App ID")} value={appId} />
              <FieldRow label={t("game_edit.field_source", "Source")} value={game?.source ?? appInfo?.provider ?? "steam"} />
              <FieldRow
                label={t("game_edit.field_installed", "Installed")}
                value={game ? (game.steamInstalled ? t("game_edit.yes", "Yes") : t("game_edit.no", "No")) : t("game_edit.unknown", "Unknown")}
              />
              <FieldRow label={t("game_edit.install_dir", "Install Directory")} value={game?.installDir} />
              <FieldRow label={t("game_edit.library_path", "Library Path")} value={game?.libraryPath} />
              <FieldRow
                label={t("game_edit.size_disk", "Size on Disk")}
                value={game?.sizeOnDisk ? formatBytes(game.sizeOnDisk) : null}
              />
              <FieldRow label={t("game_edit.exe_path", "Executable Path")} value={game?.executablePath} />

              {!game?.installDir && (
                <p className="rounded-xl bg-white/[0.02] px-4 py-3 text-xs text-(--color-muted)/60">
                  Install folder is not available.
                </p>
              )}

              {game?.installDir && (
                <button
                  type="button"
                  onClick={handleOpenInstallFolder}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                >
                  <FolderOpen className="h-4 w-4 text-(--color-muted)" />
                  Open Install Folder
                </button>
              )}

            </div>
          </>
        )}
      </div>
    );
  }

  function renderMediaTab() {
    // Manual-create mode: show "Save first" message
    if (isCreateMode && !createdManualId) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Image className="mb-4 h-12 w-12 text-(--color-muted)/30" />
          <p className="text-sm text-(--color-muted)">
            {t("game_edit.save_first", "Save the game first to add artwork.")}
          </p>
          <p className="mt-1 text-xs text-(--color-muted)/60">
            {t("game_edit.fill_details", "Fill in the game details on the General tab, then save.")}
          </p>
        </div>
      );
    }

    const screenshotCount = metadata?.screenshots?.length ?? 0;
    const movieCount = metadata?.movies?.length ?? 0;

    return (
      <div className="space-y-5">
        {MEDIA_ROLES.map(({ role, label, icon: RoleIcon, desc }) => (
          <GameMediaRoleRow
            key={role}
            label={label}
            icon={RoleIcon}
            desc={desc}
            previewUrl={getPreviewUrl(role)}
            previewStatus={getPreviewStatus(role)}
            currentPath={currentPath(role)}
            saving={saving}
            urlExpanded={expandedUrl === role}
            browseOpen={browseOpenFor === role}
            isBrowsing={browsingRole === role}
            urlValue={urlInputs[role] ?? ""}
            isManual={isManualMode || isCreateMode}
            sourceAvailability={sourceAvailability}
            onChooseLocalFile={(file) => handleFilePick(role, file)}
            onToggleUrl={() => setExpandedUrl(expandedUrl === role ? null : role)}
            onUrlChange={(v) => setUrlInputs((prev) => ({ ...prev, [role]: v }))}
            onUrlSubmit={() => handleUrlDownload(role)}
            onToggleBrowse={() => setBrowseOpenFor(browseOpenFor === role ? null : role)}
            onSourcePick={(sourceId) => handleSourcePick(role, sourceId as SourceId)}
            onOpenWebSearch={() => handleOpenImageSearch(role)}
            onRemove={() => handleRemove(role)}
          />
        ))}

        {/* ── Read-only: Screenshots ── */}
        {!isCreateMode && metadata && screenshotCount > 0 && (
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-(--color-muted)" />
              <span className="text-sm font-medium text-(--color-text)">{t("game_edit.screenshots", "Screenshots")}</span>
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                {screenshotCount}
              </span>
              <span className="text-[10px] text-(--color-muted)/50">Read-only</span>
            </div>
            <p className="mt-0.5 text-[11px] text-(--color-muted)/60">
              {t("game_edit.screenshots_hint", "Screenshots from Steam Store metadata. Use Actions tab to refresh.")}
            </p>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {metadata.screenshots!.map((url, i) => {
                const thumbUrl = url.replace(/\.(jpg|png|webp)$/, "_thumb.$1");
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block shrink-0"
                  >
                    <img
                      src={thumbUrl}
                      alt={`Screenshot ${i + 1}`}
                      className="h-20 w-36 rounded-lg object-cover ring-1 ring-white/10 transition hover:ring-(--color-accent)/50"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Read-only: Trailers ── */}
        {!isCreateMode && metadata && movieCount > 0 && (
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-(--color-muted)" />
              <span className="text-sm font-medium text-(--color-text)">{t("game_edit.trailers_videos", "Trailers / Videos")}</span>
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                {movieCount}
              </span>
              <span className="text-[10px] text-(--color-muted)/50">Read-only</span>
            </div>
            <p className="mt-0.5 text-[11px] text-(--color-muted)/60">
              {t("game_edit.trailers_hint", "Trailers from Steam Store metadata. Refresh via Actions tab.")}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {metadata.movies!.map((movie) => {
                const hasMp4 = !!movie.mp4_max;
                const hasWebm = !!movie.webm_max;
                const hasStream = !!movie.hls || !!movie.dash;
                const formats = [
                  hasMp4 && "MP4",
                  hasWebm && "WebM",
                  hasStream && "Stream",
                ].filter(Boolean).join(", ");
                return (
                  <div
                    key={movie.id}
                    className="flex items-start gap-3 rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-3 py-2.5"
                  >
                    {movie.thumbnail ? (
                      <img
                        src={movie.thumbnail}
                        alt={movie.name}
                        className="h-12 w-20 shrink-0 rounded object-cover ring-1 ring-white/10"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-white/5">
                        <Video className="h-4 w-4 text-(--color-muted)/40" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-(--color-text)">
                        {movie.name}
                      </p>
                      <p className="mt-0.5 text-[10px] text-(--color-muted)/60">
                        Formats: {formats || "N/A"}
                      </p>
                      {hasMp4 && (
                        <a
                          href={movie.mp4_max!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-[10px] text-(--color-accent) hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open MP4
                        </a>
                      )}
                      {!hasMp4 && hasStream && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-(--color-muted)/50">
                          Streaming (HLS/DASH)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleOpenMediaFolder}
          disabled={!appId && !manualGameId && !appIdDraft && !debridProviderGameId && !epicProviderGameId}
          className="mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FolderOpen className="h-4 w-4" />
          Open Media Folder
        </button>
      </div>
    );
  }

  const tabContent: Record<TabId, () => React.ReactNode> = {
    details: renderGeneralTab,
    installation: renderInstallationTab,
    media: renderMediaTab,
    info: renderInfoTab,
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit Game Details"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        ref={panelRef}
        className="relative mx-4 w-full max-w-[900px] flex h-[88vh] flex-col rounded-2xl border border-(--color-border) lf-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-(--color-border) px-6 py-4">
          <h2 className="text-lg font-semibold text-(--color-text)">
            {isCreateMode ? t("game_edit.add_manual", "Add Manual Game") : t("game_edit.edit_details", "Edit Game Details")}
            {(appInfo?.name ?? manualEntry?.name) && (
              <span className="ml-2 text-sm font-normal text-(--color-muted)">
                — {appInfo?.name ?? manualEntry?.name}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) hover:bg-white/10 hover:text-(--color-text)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 overflow-x-auto border-b border-(--color-border) px-2">
          {TABS.map(({ id, label, icon: TabIcon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium transition ${
                activeTab === id
                  ? "border-b-2 border-(--color-accent) text-(--color-text)"
                  : "text-(--color-muted) hover:text-(--color-text)"
              }`}
            >
              <TabIcon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-(--color-muted)">
              Loading game data...
            </div>
          ) : (
            tabContent[activeTab]?.() ?? (
              <div className="flex items-center justify-center py-16 text-sm text-(--color-muted)">
                Select a tab to edit.
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-(--color-border) px-6 py-3">
          {capabilities.canUseMetadataProviders && (
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() => setMetadataMenuOpen(!metadataMenuOpen)}
                disabled={metadataDownloading}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3.5 py-2 text-xs font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text) disabled:opacity-50"
              >
                {metadataDownloading ? t("game_edit.downloading", "Downloading...") : t("game_edit.download_metadata", "Download Metadata")}
                <ChevronDown className="h-3 w-3" />
              </button>
              {metadataMenuOpen && (
                <div className="absolute bottom-full right-0 z-20 mb-1 w-48 rounded-xl border border-(--color-border) bg-(--color-bg) py-1 shadow-xl">
                  {capabilities.canUseSteamMetadata && (
                    <SourceOption
                      label={isManualMode || isCreateMode ? (appIdDraft ? "Steam" : t("game_edit.steam_by_name", "Steam (by name)")) : "Steam"}
                      icon={isManualMode || isCreateMode ? (appIdDraft ? Globe : Search) : Globe}
                      onClick={() => handleDownloadMetadata("steam")}
                    />
                  )}
                  {capabilities.canUseIgdbMetadata && (
                    <SourceOption
                      label="IGDB"
                      icon={Image}
                      onClick={() => handleDownloadMetadata("igdb")}
                    />
                  )}
                  {capabilities.canUseRawgMetadata && (
                    <SourceOption
                      label="RAWG"
                      icon={Image}
                      onClick={() => handleDownloadMetadata("rawg")}
                    />
                  )}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-lg border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasEdits}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition ${
                saving || !hasEdits
                  ? "cursor-not-allowed bg-(--color-accent)/50 opacity-50"
                  : "bg-(--color-accent) hover:opacity-90"
              }`}
            >
              <Save className="h-4 w-4" />
              {saving ? t("game_edit.saving", "Saving...") : t("game_edit.save", "Save")}
            </button>
          </div>
        </div>
      </div>

      {imageSearchOpen && imageSearchRole && (appId || appIdDraft || manualGameId || epicProviderGameId) && (
        <GameImageSearchDialog
          open={imageSearchOpen}
          onClose={() => { setImageSearchOpen(false); setImageSearchRole(null); }}
          appId={appId || appIdDraft || undefined}
          libraryId={(!appId && !appIdDraft) ? (manualGameId ?? (isEpicMode ? `epic:${epicProviderGameId}` : undefined)) : undefined}
          gameTitle={appInfo?.name ?? game?.title ?? appId ?? manualGameId ?? ""}
          role={imageSearchRole}
          onMediaUpdated={handleMediaUpdated}
          onDownloadComplete={handleDownloadComplete}
          settings={{
            googleSearchApiKey: settings?.googleSearchApiKey,
            googleSearchCx: settings?.googleSearchCx,
            bingSearchApiKey: settings?.bingSearchApiKey,
          }}
        />
      )}
    </div>,
    document.body,
  );
}

// ── Sub-components ──

function EditableField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  multiLine,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  multiLine?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-(--color-muted)">{label}</label>
      {multiLine ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          maxLength={maxLength}
          className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20 resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="w-full rounded-xl border border-(--surface-active-border) bg-white/5 px-4 py-2.5 text-sm text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
        />
      )}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-(--color-muted)">{label}</label>
      <p className="text-sm text-(--color-text)">{value}</p>
    </div>
  );
}

/* SourceOption is imported from GameMediaRoleRow */

function formatBytes(bytes?: number): string {
  if (bytes == null) return "Unknown";
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
