import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Save,
  Image,
  Type,
  Link,
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
  Eye,
  Globe,
  ChevronDown,
  Download,
  ExternalLink,
  Video,
  Search,
} from "lucide-react";
import type { GameMediaPaths, GameAppInfo } from "../../services/tauri";
import type { LibraryGame } from "../../types/libraryGame";
import { getGameAppInfo, resolveSteamGridDbArtwork, searchSteamGridDbGames, resolveSteamGridDbArtworkByGameId, openGameMetadataFolder, openGameMediaFolder, openFolder, resolveSteamStoreSearch, openProviderMediaFolder, pickFile, pickFolder } from "../../services/tauri";
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
  open: boolean;
  onClose: () => void;
  initialTab?: TabId;
  game?: LibraryGame | null;
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

type TabId = "general" | "advanced" | "media" | "links" | "installation" | "actions" | "scripts";

type MediaRole = "cover" | "landscape" | "background" | "logo" | "icon";

type SourceId = "local" | "steam" | "sgdb" | "igdb" | "rawg" | "url" | "file";

type MetadataSourceId = "steam" | "igdb" | "rawg";

// ── Tab config ──

const TABS: { id: TabId; label: string; icon: typeof Type }[] = [
  { id: "general", label: "General", icon: Type },
  { id: "advanced", label: "Advanced", icon: Info },
  { id: "media", label: "Media", icon: Image },
  { id: "links", label: "Links", icon: Link },
  { id: "installation", label: "Installation", icon: HardDrive },
  { id: "actions", label: "Actions", icon: Eye },
  { id: "scripts", label: "Scripts", icon: Code },
];

const MEDIA_ROLES: { role: MediaRole; label: string; icon: typeof FileImage; desc: string }[] = [
  { role: "icon", label: "Icon", icon: Camera, desc: "Small square icon for sidebar and grid" },
  { role: "cover", label: "Cover Image", icon: Monitor, desc: "Poster/box art for library grid" },
  { role: "background", label: "Background Image", icon: Layers, desc: "Full hero background behind artwork" },
  { role: "landscape", label: "Landscape Image", icon: PanelTop, desc: "Wide hero/carousel image" },
  { role: "logo", label: "Logo", icon: Palette, desc: "Game logo for overlays and hero" },
];

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

/** Steam library_600x900.jpg URL — the proper vertical poster for cover art. */
function buildSteamCoverUrl(appId: string): string | null {
  const id = parseInt(appId, 10);
  if (!id || isNaN(id) || id <= 0) return null;
  return `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`;
}

// ── Debug tracing for manual cover persistence ──
const DEBUG_MANUAL_COVER = false;

// ── Component ──

export default function GameEditDialog({
  appId,
  manualGameId,
  epicProviderGameId,
  open,
  onClose,
  initialTab = "general",
  game,
  settings,
}: GameEditDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mode detection — manual games use manualGameId, Steam games use appId, Epic uses epicProviderGameId
  const isManualMode = !!manualGameId && !appId && !epicProviderGameId;
  const isEpicMode = !!epicProviderGameId && !appId && !manualGameId;
  const isCreateMode = !appId && !manualGameId && !epicProviderGameId;
  const effectiveId = manualGameId ?? epicProviderGameId ?? appId ?? "";

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
  }, [appId, manualGameId, epicProviderGameId, isManualMode, isEpicMode]);

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
    if (isManualMode && manualGameId) {
      const entry = getManualGame(manualGameId);
      if (entry) {
        setManualEntry(entry);
        loadDraftsFromManualEntry(entry);
      }
      setLoading(false);
      loadRolePreviews();
      return;
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

    // Steam edit mode (existing)
    getGameAppInfo(appId!).then((info) => {
      setAppInfo(info);
      loadDraftsFromUserData(info);
      setLoading(false);
      loadRolePreviews();
    });
    const appIdNum = Number(appId);
    if (!isNaN(appIdNum)) {
      resolveGameMetadata([appIdNum]).then((m) => {
        setMetadata(m[appIdNum] ?? null);
        setLoading(false);
      }).catch(() => {});
    }
  }, [open, appId, manualGameId]);

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
    if (!appId && !isManualMode && !isCreateMode && !isEpicMode) return;

    // Manual/create: IGDB or Steam name search
    if (isManualMode || isCreateMode) {
      const searchName = nameDraft.trim();
      if (!searchName) {
        showError("Enter a game name first");
        return;
      }
      setMetadataDownloading(true);
      if (DEBUG_MANUAL_METADATA) console.log(`[MANUAL][META] source=${source} searchName="${searchName}" isManual=${isManualMode} isCreate=${isCreateMode}`);

      try {
        if (source === "igdb") {
          if (!settings?.igdbClientId || !settings?.igdbClientSecret) {
            showError("Configure IGDB credentials in Settings first");
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
              showSuccess(`Found "${result.name ?? searchName}" on IGDB — metadata filled. Use Media tab to add artwork.`);
            } else {
              showSuccess("Metadata filled from IGDB");
            }
          } else {
            if (DEBUG_MANUAL_METADATA) console.warn("[MANUAL][META] IGDB returned null — no results or auth failure");
            showError(`No IGDB results for "${searchName}"`);
          }
        } else if (source === "steam") {
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] calling resolveSteamStoreSearch...");
          const steamResults = await resolveSteamStoreSearch({ term: searchName, limit: 5 });
          if (DEBUG_MANUAL_METADATA) console.log("[MANUAL][META] Steam results:", steamResults);
          if (!steamResults || steamResults.length === 0) {
            showError(`No Steam results for "${searchName}"`);
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
            showSuccess(`Found "${meta.name ?? best.name}" on Steam — metadata filled. Use Media tab to add artwork.`);
          } else {
            setHasEdits(true);
            showSuccess(`Found "${best.name}" on Steam — name filled. Metadata not available for this app.`);
          }
        }
      } catch (e) {
        if (DEBUG_MANUAL_METADATA) console.error("[MANUAL][META] error:", e);
        showError(`Failed to search ${source === "igdb" ? "IGDB" : "Steam"}`);
      }
      setMetadataDownloading(false);
      return;
    }

    // Epic games: search Steam by game name (same as manual Steam path)
    if (isEpicMode) {
      const searchName = nameDraft.trim() || game?.title || "";
      if (!searchName) {
        showError("Enter a game name first or use the game title");
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
            showError("Configure IGDB credentials in Settings first");
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
        showError(`Failed to search ${source === "steam" ? "Steam" : "IGDB"}`);
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
            showSuccess("Metadata downloaded from Steam");
          } else {
            showError("No Steam metadata available for this app");
          }
        }
      } else if (source === "igdb") {
        if (!settings?.igdbClientId || !settings?.igdbClientSecret) {
          showError("Configure IGDB credentials in Settings first");
          return;
        }
        const igdbData = await fetchIgdbArtworkDeduped({
          clientId: settings.igdbClientId,
          clientSecret: settings.igdbClientSecret,
          appId,
        });
        if (igdbData) {
          showSuccess("Metadata downloaded from IGDB");
          setHasEdits(true);
        } else {
          showError("No IGDB data available for this app");
        }
      } else if (source === "rawg") {
        if (!settings?.rawgApiKey) {
          showError("Configure RAWG API key in Settings first");
          return;
        }
        const rawgData = await fetchRawgArtworkDeduped({
          apiKey: settings.rawgApiKey,
          appId,
        });
        if (rawgData) {
          showSuccess("Metadata downloaded from RAWG");
          setHasEdits(true);
        } else {
          showError("No RAWG data available for this app");
        }
      }
    } catch {
      showError(`Failed to download metadata from ${source}`);
    }
    setMetadataDownloading(false);
  }, [appId, settings, isManualMode, isCreateMode, isEpicMode, nameDraft, game?.title]);

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
      if (isManualMode && manualGameId) {
        await openProviderMediaFolder("manual", manualGameId);
      } else if (isEpicMode && epicProviderGameId) {
        await openProviderMediaFolder("epic", epicProviderGameId);
      } else if (appId) {
        await openGameMediaFolder(appId);
      }
    } catch {
      showError("Could not open media folder");
    }
  }, [appId, manualGameId, epicProviderGameId, isManualMode, isEpicMode]);

  const handleBrowseExe = useCallback(async () => {
    const fullPath = await pickFile("Select Executable", [
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
    const folder = installDirDraft.trim() || game?.installDir || "";
    if (!folder) {
      showError("No install folder configured");
      return;
    }
    try {
      await openFolder(folder);
    } catch {
      showError("Could not open install folder");
    }
  }, [installDirDraft, game]);

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
          name: nameDraft || "Untitled Game",
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
          showSuccess("Game details saved");
        } else {
          // Create new manual game
          const newId = crypto.randomUUID();
          const newEntry: ManualGameEntry = {
            id: newId,
            name: patch.name ?? "Untitled Game",
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
          showSuccess("Manual game created");
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
        showSuccess("Epic game details saved");
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
      if (nameDraft) {
        updateGame(appId!, { title: nameDraft });
      }
      notifyMediaUpdated(appId!);
      setAppInfo(updatedEntry);
      setHasEdits(false);
      showSuccess("Game details saved");
    } catch {
      showError("Failed to save game details");
    }
    setSaving(false);
  }, [appId, manualGameId, epicProviderGameId, isManualMode, isEpicMode, isCreateMode, createdManualId, appInfo, nameDraft, genresDraft, developersDraft, publishersDraft, categoriesDraft, featuresDraft, tagsDraft, releaseDateDraft, descriptionDraft, sortingNameDraft, userScoreDraft, criticScoreDraft, communityScoreDraft, reviewSummaryDraft, reviewCountDraft, reviewSourceDraft, seriesDraft, ageRatingDraft, regionDraft, completionStatusDraft, executablePathDraft, workingDirectoryDraft, launchArgsDraft, installDirDraft, linkedIgdbIdDraft, updateGame]);

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
        installDirDraft !== (entry?.installDir ?? "");
      setHasEdits(hasChanges || isCreateMode);
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
  }, [open, appInfo, manualEntry, epicOverrides, isManualMode, isEpicMode, isCreateMode, nameDraft, genresDraft, developersDraft, publishersDraft, categoriesDraft, featuresDraft, tagsDraft, releaseDateDraft, descriptionDraft, sortingNameDraft, userScoreDraft, criticScoreDraft, communityScoreDraft, reviewSummaryDraft, reviewCountDraft, reviewSourceDraft, seriesDraft, ageRatingDraft, regionDraft, completionStatusDraft, executablePathDraft, workingDirectoryDraft, launchArgsDraft, installDirDraft]);

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
    [appInfo, manualEntry, isManualMode, isCreateMode, manualGameId, createdManualId],
  );

  const commitMediaUpdate = useCallback(
    async (updatedMedia: GameMediaPaths) => {
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

      // ── Steam game — existing path ──
      if (!appId) return;
      await updateGameAppinfoMediaIfChanged(
        appId,
        appInfo?.name ?? null,
        updatedMedia,
        appInfo?.remote ?? null,
        appInfo?.mediaSources ?? null,
        "gameEditDialog",
      );
      invalidateResolvedMediaCache(appId);
      notifyMediaUpdated(appId);
      setAppInfo((prev) => (prev ? { ...prev, media: updatedMedia } : prev));
      // Trigger immediate React re-render across library/tiles
      updateGame(appId, {} as Partial<LibraryGame>);
    },
    [appId, appInfo, updateGame, isManualMode, isCreateMode, isEpicMode, epicProviderGameId, manualGameId, createdManualId],
  );

  // ── File pick handler ──

  const handleFilePick = useCallback(
    async (role: MediaRole, externalFile?: File) => {
      const input = fileInputRefs.current[role];
      const file = externalFile ?? input?.files?.[0];
      if (!file) return;

      const maxBytes = role === "icon" || role === "logo" ? SMALL_FILE_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
      if (file.size > maxBytes) {
        const limitMb = maxBytes / (1024 * 1024);
        showError(`File too large (max ${limitMb}MB for ${role})`);
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
            showSuccess(`${role} updated from local file`);
          } else {
            showError(`Failed to save ${role} file`);
          }
        } else if (appId) {
          // Steam game — use existing base64 save
          const relPath = await saveGameMediaFile(appId, role, base64, ext);
          const updatedMedia = buildUpdatedMedia(role, relPath);
          await commitMediaUpdate(updatedMedia);
          await refreshRolePreview(role);
          showSuccess(`${role} updated from local file`);
        }
      } catch {
        showError(`Failed to save ${role} file`);
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
        showError("Enter a valid URL (http:// or https://)");
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
          showSuccess(`${role} downloaded`);
          setUrlInputs((prev) => ({ ...prev, [role]: "" }));
          setExpandedUrl(null);
        } else {
          if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][DOWNLOAD_RESULT] ok=false reason=rust-returned-null`);
          showError("URL did not return an image. The server may have rejected the request.");
        }
      } catch (err) {
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][ERROR] role=${role} error=${err instanceof Error ? err.message : String(err)}`);
        showError("Could not download image. The server rejected the request.");
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
            showError("Enter a game name first to search IGDB");
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
              showError(`No IGDB candidates available for ${role}. IGDB provides cover and screenshots only.`);
            }
          } catch (e) {
            showError(typeof e === "string" ? e : "Failed to search IGDB");
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
                showError("Enter a game name first to search SteamGridDB");
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
                showError(`No SteamGridDB ${role} art available for this game`);
              }
            } else {
              showError("No SteamGridDB results found");
            }
          } catch (e) {
            const msg = typeof e === "string" ? e : String(e ?? "Failed to search SteamGridDB");
            // Never show raw HTML in toast
            if (/<html/i.test(msg)) {
              showError("SteamGridDB search failed. Check API key or endpoint.");
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
          const steamAppId = manualEntry?.linkedSteamAppId;
          if (!steamAppId) {
            showError("Link a Steam App ID first to use Steam Official Assets");
            return;
          }
          setSaving(true);
          setBrowsingRole(role);
          try {
            const metaMap = await resolveGameMetadata([Number(steamAppId)]);
            const meta = metaMap[Number(steamAppId)];
            if (meta) {
              const steamUrlMap: Record<MediaRole, string | null | undefined> = {
                icon: null,
                cover: buildSteamCoverUrl(steamAppId),
                background: meta.library_hero_image ?? meta.hero_image ?? meta.background_image,
                landscape: meta.library_header_image ?? meta.header_image,
                logo: meta.library_logo_image ?? meta.logo_image,
              };
              const downloadUrl = steamUrlMap[role] ?? null;
              if (downloadUrl) {
                await handleUrlDownload(role, downloadUrl);
              } else {
                showError(`No Steam official ${role} art available for this game`);
              }
            } else {
              showError("No Steam metadata available for this game");
            }
          } catch {
            showError("Failed to fetch Steam assets");
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
              showError("Enter a game name first to search SteamGridDB");
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
                showError(`No SteamGridDB ${role} art available for this game`);
              }
            } else {
              showError("No SteamGridDB results found");
            }
          } catch (e) {
            const msg = typeof e === "string" ? e : String(e ?? "Failed to search SteamGridDB");
            if (/<html/i.test(msg)) {
              showError("SteamGridDB search failed. Check API key or endpoint.");
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
            showError("Enter a game name first to search IGDB");
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
              showError(`No IGDB candidates available for ${role}. IGDB provides cover and screenshots only.`);
            }
          } catch (e) {
            showError(typeof e === "string" ? e : "Failed to search IGDB");
          }
          setSaving(false);
          setBrowsingRole(null);
          return;
        }
        showError(`Source "${sourceId}" is not available for Epic games`);
        return;
      }

      if (!appId) return;

      setSaving(true);
      setBrowsingRole(role);
      try {
        let downloadUrl: string | null = null;

        if (sourceId === "steam" && metadata) {
          const steamUrlMap: Record<MediaRole, string | null | undefined> = {
            icon: null,
            cover: buildSteamCoverUrl(appId),
            background: metadata.library_hero_image ?? metadata.hero_image ?? metadata.background_image,
            landscape: metadata.library_header_image ?? metadata.header_image,
            logo: metadata.library_logo_image ?? metadata.logo_image,
          };
          downloadUrl = steamUrlMap[role] ?? null;
        } else if (sourceId === "sgdb" && settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled) {
          try {
            const artworks = await resolveSteamGridDbArtwork([Number(appId)], settings.steamGridDbApiKey);
            const artwork = artworks?.find((a) => a.appId === Number(appId));
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
              appId,
            });
            if (igdbData?.igdbCoverUrl && (role === "cover" || role === "landscape")) {
              downloadUrl = igdbData.igdbCoverUrl;
            }
          } catch { /* IGDB failed */ }
        } else if (sourceId === "rawg" && settings?.rawgApiKey) {
          try {
            const rawgData = await fetchRawgArtworkDeduped({
              apiKey: settings.rawgApiKey,
              appId,
            });
            if (rawgData?.rawgBackgroundUrl && (role === "background" || role === "landscape")) {
              downloadUrl = rawgData.rawgBackgroundUrl;
            }
          } catch { /* RAWG failed */ }
        }

        if (downloadUrl) {
          await handleUrlDownload(role, downloadUrl);
        } else {
          showError(`No ${sourceId} source available for ${role}`);
        }
      } catch {
        showError(`Failed to get ${sourceId} source`);
      }
      setSaving(false);
      setBrowsingRole(null);
    },
    [appId, metadata, settings, handleUrlDownload, isManualMode, isCreateMode, isEpicMode, nameDraft, manualEntry?.linkedSteamAppId],
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
        showSuccess(`${role} removed`);
      } catch {
        showError(`Failed to remove ${role}`);
      }
      setSaving(false);
    },
    [effectiveId, buildUpdatedMedia, commitMediaUpdate, mediaAdapter, manualGameId, createdManualId],
  );

  // ── Backdrop click ──

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  // ── Role preview resolution ──

  async function loadRolePreviews() {
    setRolePreviews({});
    if ((isManualMode || isCreateMode) && (manualGameId ?? createdManualId)) {
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
    if ((isManualMode || isCreateMode) && (manualGameId ?? createdManualId)) {
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
      const hasLinkedSteam = !!(manualEntry?.linkedSteamAppId);
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
    return {
      canUseMetadataProviders: true,
      canUseSteamMetadata: true,
      canUseIgdbMetadata: !!(settings?.igdbClientId && settings?.igdbClientSecret),
      canUseRawgMetadata: !!(settings?.rawgApiKey),
      canUseSteamAssets: !!(metadata?.capsule_image || metadata?.header_image || metadata?.library_hero_image || metadata?.library_logo_image),
      canUseIgdbAssets: !!(settings?.igdbClientId && settings?.igdbClientSecret),
      canUseSgdbAssets: !!(settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled),
      canUseRawgAssets: !!(settings?.rawgApiKey),
    };
  }, [settings, metadata, isManualMode, isCreateMode, manualEntry?.linkedSteamAppId]);

  const sourceAvailability = useMemo(() => ({
    sgdb: capabilities.canUseSgdbAssets,
    igdb: capabilities.canUseIgdbAssets,
    rawg: capabilities.canUseRawgAssets,
    steam: capabilities.canUseSteamAssets,
  }), [capabilities]);

  if (!open) return null;

  const currentPath = (role: MediaRole): string | null => {
    const key = ROLE_TO_PATH_KEY[role];
    if ((isManualMode || isCreateMode) && manualEntry) {
      return (manualEntry[key as keyof ManualGameEntry] as string) ?? null;
    }
    return appInfo?.media?.[key] ?? null;
  };

  // ── Editable text field helper ──

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

  // ── Tab content renderers ──

  function renderGeneralTab() {
    return (
      <div className="space-y-6">
        {/* Download Metadata — capability-driven */}
        {capabilities.canUseMetadataProviders && (
          <div className="relative flex items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
            <Download className="h-4 w-4 text-(--color-accent)" />
            <span className="flex-1 text-sm text-(--color-text)">Download metadata from online sources</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMetadataMenuOpen(!metadataMenuOpen)}
              disabled={metadataDownloading}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-3.5 py-2 text-xs font-medium text-(--color-accent-text) transition hover:opacity-90 disabled:opacity-50"
            >
              {metadataDownloading ? "Downloading..." : "Download Metadata..."}
              <ChevronDown className="h-3 w-3" />
            </button>
            {metadataMenuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-(--color-border) bg-(--color-bg) py-1 shadow-xl">
                {capabilities.canUseSteamMetadata && (
                  <SourceOption
                    label={isManualMode || isCreateMode ? "Steam (by name)" : "Steam"}
                    icon={isManualMode || isCreateMode ? Search : Globe}
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
        </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Left column - Identity & Credits */}
          <div className="space-y-4">
            <EditableField
              label="Name"
              value={nameDraft}
              onChange={setNameDraft}
              placeholder="Enter game name"
              maxLength={128}
            />
            <EditableField
              label="Sorting Name"
              value={sortingNameDraft}
              onChange={setSortingNameDraft}
              placeholder="Name used for alphabetical sorting"
              maxLength={128}
            />
            <EditableField
              label="Genres"
              value={genresDraft}
              onChange={setGenresDraft}
              placeholder="Action, Adventure, RPG (comma-separated)"
            />
            <EditableField
              label="Developer"
              value={developersDraft}
              onChange={setDevelopersDraft}
              placeholder="Developer name"
            />
            <EditableField
              label="Publishers"
              value={publishersDraft}
              onChange={setPublishersDraft}
              placeholder="Publisher name (comma-separated)"
            />
          </div>

          {/* Right column - Classification & Metadata */}
          <div className="space-y-4">
            <EditableField
              label="Release Date"
              value={releaseDateDraft}
              onChange={setReleaseDateDraft}
              placeholder="e.g. Jan 15, 2024"
            />
            <EditableField
              label="Features"
              value={featuresDraft}
              onChange={setFeaturesDraft}
              placeholder="Steam Cloud, Controller Support (comma-separated)"
            />
            <EditableField
              label="Tags"
              value={tagsDraft}
              onChange={setTagsDraft}
              placeholder="open-world, fps, horror (comma-separated)"
            />
            <EditableField
              label="Categories"
              value={categoriesDraft}
              onChange={setCategoriesDraft}
              placeholder="Single-player, Multi-player (comma-separated)"
            />
            <EditableField
              label="Series"
              value={seriesDraft}
              onChange={setSeriesDraft}
              placeholder="e.g. Dark Souls, Call of Duty"
            />
            <div className="grid grid-cols-2 gap-3">
              <EditableField
                label="Age Rating"
                value={ageRatingDraft}
                onChange={setAgeRatingDraft}
                placeholder="e.g. ESRB M, PEGI 18"
              />
              <EditableField
                label="Region"
                value={regionDraft}
                onChange={setRegionDraft}
                placeholder="e.g. NA, EU, WW"
              />
            </div>
            <FieldRow label="Source" value={isManualMode || isCreateMode ? "manual" : (game?.source ?? appInfo?.provider ?? (metadata ? "steam" : null))} />
            <FieldRow label="Completion" value={completionStatusDraft || "—"} />
          </div>
        </div>

        {/* Reviews / Ratings */}
        <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--color-muted)">Reviews & Ratings</h4>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <EditableField
              label="User Score"
              value={userScoreDraft}
              onChange={setUserScoreDraft}
              placeholder="e.g. 8.5 / 10"
            />
            <EditableField
              label="Critic Score"
              value={criticScoreDraft}
              onChange={setCriticScoreDraft}
              placeholder="e.g. 86 / 100"
            />
            <EditableField
              label="Community Score"
              value={communityScoreDraft}
              onChange={setCommunityScoreDraft}
              placeholder="e.g. Very Positive"
            />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
            <EditableField
              label="Review Summary"
              value={reviewSummaryDraft}
              onChange={setReviewSummaryDraft}
              placeholder="e.g. Overwhelmingly Positive"
            />
            <EditableField
              label="Review Count"
              value={reviewCountDraft}
              onChange={setReviewCountDraft}
              placeholder="e.g. 125,432"
            />
            <EditableField
              label="Review Source"
              value={reviewSourceDraft}
              onChange={setReviewSourceDraft}
              placeholder="e.g. Steam, Metacritic"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <EditableField
            label="Description"
            value={descriptionDraft}
            onChange={setDescriptionDraft}
            placeholder="Game description..."
            multiLine
            maxLength={4000}
          />
        </div>
      </div>
    );
  }

  function renderAdvancedTab() {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <EditableField
              label="Completion Status"
              value={completionStatusDraft}
              onChange={setCompletionStatusDraft}
              placeholder="e.g. Complete, In Progress, Not Played"
            />
            {metadata?.platforms?.length ? (
              <FieldRow label="Platforms" value={metadata.platforms.join(", ")} />
            ) : null}
            {metadata?.languages?.length ? (
              <FieldRow label="Languages" value={metadata.languages.join(", ")} />
            ) : null}
          </div>
          <div className="space-y-4">
            {metadata?.dlc_count != null && metadata.dlc_count > 0 && (
              <FieldRow label="DLC Count" value={String(metadata.dlc_count)} />
            )}
            {metadata?.legal_notice && (
              <FieldRow label="Legal Notice" value={metadata.legal_notice} />
            )}
            {metadata?.store_drm_notice && (
              <FieldRow label="DRM Notice" value={metadata.store_drm_notice} />
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderLinksTab() {
    if (isManualMode || isCreateMode) {
      return (
        <div className="py-8 text-center text-sm text-(--color-muted)">
          No external links for manual games.
        </div>
      );
    }
    if (!appId) return null;
    const appIdNum = Number(appId);
    const links: { label: string; url: string; icon: typeof Globe }[] = [];
    if (!isNaN(appIdNum)) {
      links.push({ label: "Steam Store", url: `https://store.steampowered.com/app/${appIdNum}`, icon: Globe });
      links.push({ label: "SteamDB", url: `https://steamdb.info/app/${appIdNum}`, icon: ExternalLink });
      links.push({ label: "ProtonDB", url: `https://www.protondb.com/app/${appIdNum}`, icon: ExternalLink });
      links.push({ label: "SteamGridDB", url: `https://www.steamgriddb.com/search?q=${encodeURIComponent(appInfo?.name ?? appId)}`, icon: ExternalLink });
      links.push({ label: "PCGamingWiki", url: `https://www.pcgamingwiki.com/api/appid.php?appid=${appIdNum}`, icon: ExternalLink });
    }

    return (
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
        {links.length === 0 && (
          <p className="py-8 text-center text-sm text-(--color-muted)">
            No links available for this game.
          </p>
        )}
      </div>
    );
  }

  function renderInstallationTab() {
    const isManual = isManualMode || isCreateMode;
    const hasExe = !!executablePathDraft.trim();

    return (
      <div className="space-y-5">
        {isManual ? (
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
                      Warning: This looks like a bare filename. Use Browse to select the full path so the game can launch.
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
                        const folder = await pickFolder("Select Working Directory");
                        if (folder) { setWorkingDirectoryDraft(folder); setHasEdits(true); }
                      }}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-(--color-muted)/60">
                    Auto-filled to executable parent folder if empty.
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
                        const folder = await pickFolder("Select Install Folder");
                        if (folder) { setInstallDirDraft(folder); setHasEdits(true); }
                      }}
                      className="shrink-0 rounded-xl border border-(--surface-active-border) bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-(--color-text) transition hover:bg-white/10"
                    >
                      Browse
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-(--color-muted)/60">
                    Auto-filled to executable parent folder if empty.
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
                {/* Installed state */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Installed</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${hasExe ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-400"}`}>
                    {hasExe ? "Yes" : "Not configured"}
                  </span>
                </div>

                {/* Size on Disk */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-(--color-text)">Install Size</span>
                  <span className="text-xs text-(--color-muted)">
                    {game?.sizeOnDisk ? formatBytes(game.sizeOnDisk) : "Calculation not available yet"}
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
                  Additional launch entries will be available later.
                </p>
              </div>
            </div>

            {isCreateMode && !hasExe && (
              <p className="rounded-xl bg-white/[0.02] px-4 py-3 text-xs text-(--color-muted)/70">
                Configure at least an executable path to mark this game as installed.
              </p>
            )}
          </>
        ) : (
          <>
            {/* ── Steam game: read-only install info ── */}
            <div className="space-y-4">
              <FieldRow label="App ID" value={appId} />
              <FieldRow label="Source" value={game?.source ?? appInfo?.provider ?? "steam"} />
              <FieldRow
                label="Installed"
                value={game ? (game.steamInstalled ? "Yes" : "No") : "Unknown"}
              />
              <FieldRow label="Install Directory" value={game?.installDir} />
              <FieldRow label="Library Path" value={game?.libraryPath} />
              <FieldRow
                label="Size on Disk"
                value={game?.sizeOnDisk ? formatBytes(game.sizeOnDisk) : null}
              />
              <FieldRow label="Executable Path" value={game?.executablePath} />

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

              <button
                type="button"
                onClick={handleOpenMediaFolder}
                disabled={!appId}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3 text-sm font-medium text-(--color-text) transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FolderOpen className="h-4 w-4 text-(--color-muted)" />
                Open Media Folder
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderActionsTab() {
    const hasId = !!appId || !!effectiveId;
    const actionButtons: { label: string; icon: typeof FolderOpen; onClick: () => void; disabled?: boolean }[] = [
      {
        label: "Open Metadata Folder",
        icon: FolderOpen,
        onClick: () => { if (effectiveId) openGameMetadataFolder(effectiveId); onClose(); },
        disabled: !hasId,
      },
      {
        label: "Open Media Folder",
        icon: FolderOpen,
        onClick: () => {
          if (isManualMode && manualGameId) { openProviderMediaFolder("manual", manualGameId); }
          else if (effectiveId) { openGameMediaFolder(effectiveId); }
          onClose();
        },
        disabled: !hasId,
      },
      ...(!isManualMode && !isCreateMode && appId ? [{
        label: "Refresh Artwork",
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
            showSuccess("Artwork refresh triggered");
            onClose();
          } catch {
            showError("Artwork refresh failed");
          }
        },
        disabled: false,
      }] : []),
      {
        label: "Copy App ID",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(effectiveId).catch(() => {});
          showSuccess("App ID copied");
        },
        disabled: !hasId,
      },
      ...(!isManualMode && !isCreateMode && appId ? [{
        label: "Open Steam Page",
        icon: Globe,
        onClick: () => {
          window.open(`https://store.steampowered.com/app/${appId}`, "_blank");
          onClose();
        },
        disabled: false,
      }] : []),
    ];

    return (
      <div className="space-y-3">
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
        <p className="mt-2 text-xs text-(--color-muted)/60">
          These actions do not modify the game installation.
        </p>
      </div>
    );
  }

  function renderScriptsTab() {
    const scripts = game?.luaScripts ?? [];
    return (
      <div className="space-y-4">
        <FieldRow
          label="Has Lua Scripts"
          value={game ? (game.hasLua ? "Yes" : "No") : "Unknown"}
        />
        <FieldRow
          label="Active"
          value={game ? (game.isLuaActive ? "Active" : "Inactive") : null}
        />
        {scripts.length > 0 && (
          <div>
            <label className="mb-2 block text-sm font-medium text-(--color-text)">
              Scripts ({scripts.length})
            </label>
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {scripts.map((s: { name?: string; path?: string }, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-(--surface-active-border) bg-white/[0.02] px-3 py-2"
                >
                  <Code className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
                  <span className="truncate text-xs text-(--color-text)">
                    {s.name ?? s.path ?? `Script ${i + 1}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!game && (
          <p className="text-xs text-(--color-muted)/60">
            Install the game to see script details.
          </p>
        )}
        {game && scripts.length === 0 && (
          <p className="text-xs text-(--color-muted)/60">
            No Lua scripts found for this game.
          </p>
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
            Save the game first to add artwork.
          </p>
          <p className="mt-1 text-xs text-(--color-muted)/60">
            Fill in the game details on the General tab, then save.
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

        {/* ── Read-only: Screenshots (Steam only) ── */}
        {!isManualMode && !isCreateMode && metadata && screenshotCount > 0 && (
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-(--color-muted)" />
              <span className="text-sm font-medium text-(--color-text)">Screenshots</span>
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                {screenshotCount}
              </span>
              <span className="text-[10px] text-(--color-muted)/50">Read-only</span>
            </div>
            <p className="mt-0.5 text-[11px] text-(--color-muted)/60">
              Screenshots from Steam Store metadata. Use Actions tab to refresh.
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

        {/* ── Read-only: Trailers (Steam only) ── */}
        {!isManualMode && !isCreateMode && metadata && movieCount > 0 && (
          <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-(--color-muted)" />
              <span className="text-sm font-medium text-(--color-text)">Trailers / Videos</span>
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                {movieCount}
              </span>
              <span className="text-[10px] text-(--color-muted)/50">Read-only</span>
            </div>
            <p className="mt-0.5 text-[11px] text-(--color-muted)/60">
              Trailers from Steam Store metadata. Refresh via Actions tab.
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
      </div>
    );
  }

  const tabContent: Record<TabId, () => React.ReactNode> = {
    general: renderGeneralTab,
    advanced: renderAdvancedTab,
    media: renderMediaTab,
    links: renderLinksTab,
    installation: renderInstallationTab,
    actions: renderActionsTab,
    scripts: renderScriptsTab,
  };

  return createPortal(
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Edit Game Details"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        ref={panelRef}
        className="relative mx-4 w-full max-w-[900px] flex max-h-[88vh] flex-col rounded-2xl border border-(--color-border) bg-(--color-bg) shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-(--color-border) px-6 py-4">
          <h2 className="text-lg font-semibold text-(--color-text)">
            {isCreateMode ? "Add Manual Game" : "Edit Game Details"}
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
          <button
            type="button"
            onClick={handleOpenMediaFolder}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-(--surface-active-border) bg-white/5 px-4 py-2 text-sm font-medium text-(--color-muted) transition hover:bg-white/10 hover:text-(--color-text)"
          >
            <FolderOpen className="h-4 w-4" />
            Open Media Folder
          </button>

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
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      {imageSearchOpen && imageSearchRole && (appId || manualGameId || epicProviderGameId) && (
        <GameImageSearchDialog
          open={imageSearchOpen}
          onClose={() => { setImageSearchOpen(false); setImageSearchRole(null); }}
          appId={appId}
          libraryId={manualGameId ?? (isEpicMode ? `epic:${epicProviderGameId}` : undefined)}
          gameTitle={appInfo?.name ?? game?.title ?? appId ?? manualGameId ?? ""}
          role={imageSearchRole}
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
