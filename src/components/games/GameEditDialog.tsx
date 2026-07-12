import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Save,
  Image,
  Type,
  Upload,
  Link,
  Trash2,
  Check,
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
  Search as SearchIcon,
  ChevronDown,
  Download,
  ExternalLink,
  Video,
} from "lucide-react";
import type { GameMediaPaths, GameAppInfo } from "../../services/tauri";
import type { LibraryGame } from "../../types/libraryGame";
import { getGameAppInfo, resolveSteamGridDbArtwork, openGameMetadataFolder, openGameMediaFolder, resolveGameMediaPaths, deleteGameMediaFile } from "../../services/tauri";
import { invoke } from "@tauri-apps/api/core";
import { updateGameAppinfoMediaIfChanged, saveGameMediaFile, persistGameAppInfo, clearSessionAppInfoCache, localPathToUrl } from "../../services/gameCacheService";
import { invalidateResolvedMediaCache, refreshGameDetailsArtwork } from "../../services/gameCacheService";
import { notifyMediaUpdated } from "../../services/startupSnapshotService";
import { resolveGameMetadata } from "../../services/gameMetadataResolver";
import { fetchIgdbArtworkDeduped, fetchRawgArtworkDeduped } from "../../services/storeArtworkResolver";
import { showSuccess, showError } from "../toast/GameToast";
import type { SteamAppMetadata } from "../../types/gameMetadata";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import GameImageSearchDialog from "./GameImageSearchDialog";

// ── Constants ──

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB default
const SMALL_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB for icon/logo

// ── Types ──

export type GameEditDialogProps = {
  appId: string;
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

// ── Component ──

export default function GameEditDialog({
  appId,
  open,
  onClose,
  initialTab = "general",
  game,
  settings,
}: GameEditDialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // Sync initialTab when dialog opens
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Appinfo state
  const [appInfo, setAppInfo] = useState<GameAppInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Metadata state
  const [metadata, setMetadata] = useState<SteamAppMetadata | null>(null);

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

  // ── Load appinfo on mount ──

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setUrlInputs({});
    setExpandedUrl(null);
    setBrowseOpenFor(null);
    setBrowsingRole(null);
    setHasEdits(false);
    setRolePreviews({});
    getGameAppInfo(appId).then((info) => {
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
  }, [open, appId]);

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
          accessToken: settings.igdbClientSecret,
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
  }, [appId, settings]);

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
      await openGameMediaFolder(appId);
    } catch {
      showError("Could not open media folder");
    }
  }, [appId]);

  // ── Save all fields ──
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const media: GameMediaPaths = {
        coverPath: appInfo?.media?.coverPath ?? null,
        landscapePath: appInfo?.media?.landscapePath ?? null,
        backgroundPath: appInfo?.media?.backgroundPath ?? null,
        logoPath: appInfo?.media?.logoPath ?? null,
        iconPath: appInfo?.media?.iconPath ?? null,
      };
      const userData = buildUserData();
      const updatedEntry: GameAppInfo = {
        appId,
        provider: appInfo?.provider ?? "steam",
        name: nameDraft || null,
        updatedAt: Math.floor(Date.now() / 1000),
        media,
        mediaSources: appInfo?.mediaSources ?? null,
        remote: appInfo?.remote ?? null,
        userData: Object.keys(userData).length > 0 ? userData : null,
      };
      await persistGameAppInfo(appId, updatedEntry);
      clearSessionAppInfoCache(appId);
      if (nameDraft) {
        updateGame(appId, { title: nameDraft });
      }
      notifyMediaUpdated(appId);
      setAppInfo(updatedEntry);
      setHasEdits(false);
      showSuccess("Game details saved");
    } catch {
      showError("Failed to save game details");
    }
    setSaving(false);
  }, [appId, appInfo, nameDraft, genresDraft, developersDraft, publishersDraft, categoriesDraft, featuresDraft, tagsDraft, releaseDateDraft, descriptionDraft, sortingNameDraft, userScoreDraft, criticScoreDraft, communityScoreDraft, reviewSummaryDraft, reviewCountDraft, reviewSourceDraft, seriesDraft, ageRatingDraft, regionDraft, completionStatusDraft, updateGame]);

  // ── Track edits ──
  useEffect(() => {
    if (!open) return;
    const u = (v: unknown) => typeof v === "string" ? v : "";
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
  }, [open, appInfo, nameDraft, genresDraft, developersDraft, publishersDraft, categoriesDraft, featuresDraft, tagsDraft, releaseDateDraft, descriptionDraft, sortingNameDraft, userScoreDraft, criticScoreDraft, communityScoreDraft, reviewSummaryDraft, reviewCountDraft, reviewSourceDraft, seriesDraft, ageRatingDraft, regionDraft, completionStatusDraft]);

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
    [appInfo],
  );

  const commitMediaUpdate = useCallback(
    async (updatedMedia: GameMediaPaths) => {
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
    [appId, appInfo, updateGame],
  );

  // ── File pick handler ──

  const handleFilePick = useCallback(
    async (role: MediaRole) => {
      const input = fileInputRefs.current[role];
      if (!input) return;
      const file = input.files?.[0];
      if (!file) return;

      const maxBytes = role === "icon" || role === "logo" ? SMALL_FILE_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
      if (file.size > maxBytes) {
        const limitMb = maxBytes / (1024 * 1024);
        showError(`File too large (max ${limitMb}MB for ${role})`);
        input.value = "";
        return;
      }

      setSaving(true);
      try {
        const { base64, ext } = await readFileAsBase64(file);
        const relPath = await saveGameMediaFile(appId, role, base64, ext);
        const updatedMedia = buildUpdatedMedia(role, relPath);
        await commitMediaUpdate(updatedMedia);
        await refreshRolePreview(role);
        showSuccess(`${role} updated from local file`);
      } catch {
        showError(`Failed to save ${role} file`);
      }
      setSaving(false);
      input.value = "";
    },
    [appId, buildUpdatedMedia, commitMediaUpdate],
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
        const result = await invoke<string | null>("safe_download_image", {
          url,
          appId,
          mediaType: role,
          target: "",
          forceRefresh: true,
        });
        if (result) {
          if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][DOWNLOAD_RESULT] ok=true path=${result}`);
          const updatedMedia = buildUpdatedMedia(role, result);
          await commitMediaUpdate(updatedMedia);
          if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_URL][MANIFEST_UPDATE] role=${role} path=${result}`);
          await refreshRolePreview(role);
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
    [appId, urlInputs, buildUpdatedMedia, commitMediaUpdate],
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
          const sgdbRoleMap: Record<MediaRole, string> = {
            cover: "grid",
            landscape: "hero",
            background: "hero",
            logo: "logo",
            icon: "icon",
          };
          try {
            const artworks = await resolveSteamGridDbArtwork([Number(appId)], settings.steamGridDbApiKey);
            const artwork = artworks?.find((a) => a.appId === Number(appId));
            if (artwork) {
              const sgType = sgdbRoleMap[role];
              if (sgType === "grid") downloadUrl = artwork.gridHorizontalUrl ?? artwork.gridUrl ?? null;
              else if (sgType === "hero") downloadUrl = artwork.heroUrl ?? null;
              else if (sgType === "logo") downloadUrl = artwork.logoUrl ?? null;
              else if (sgType === "icon") downloadUrl = artwork.iconUrl ?? null;
            }
          } catch { /* SGDB failed */ }
        } else if (sourceId === "igdb" && settings?.igdbClientId && settings?.igdbClientSecret) {
          try {
            const igdbData = await fetchIgdbArtworkDeduped({
              clientId: settings.igdbClientId,
              accessToken: settings.igdbClientSecret,
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
    [appId, metadata, settings, handleUrlDownload],
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
        await deleteGameMediaFile(appId, role);
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_MEDIA][FILE_DELETED] appid=${appId} role=${role}`);
        const updatedMedia = buildUpdatedMedia(role, null);
        await commitMediaUpdate(updatedMedia);
        await refreshRolePreview(role);
        showSuccess(`${role} removed`);
      } catch {
        showError(`Failed to remove ${role}`);
      }
      setSaving(false);
    },
    [appId, buildUpdatedMedia, commitMediaUpdate],
  );

  // ── Backdrop click ──

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
  }

  // ── Role preview resolution ──

  async function loadRolePreviews() {
    setRolePreviews({});
    const resolved = await resolveGameMediaPaths(appId);
    if (!resolved) {
      MEDIA_ROLES.forEach(({ role }) => {
        const key = ROLE_TO_PATH_KEY[role];
        const appPath = appInfo?.media?.[key];
        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_MEDIA][LOAD_CURRENT] appid=${appId} role=${role} path=${appPath} exists=false`);
      });
      return;
    }
    const previews: Record<string, RolePreviewEntry> = {};
    for (const { role } of MEDIA_ROLES) {
      const key = ROLE_TO_PATH_KEY[role];
      const appPath = appInfo?.media?.[key];
      const absPath = resolved[key];
      if (absPath && typeof absPath === "string") {
        const url = localPathToUrl(absPath);
        previews[role] = { url, status: "set" };
        if (DEBUG_MEDIA_EDIT) {
          console.log(`[GAME_EDIT_MEDIA][LOAD_CURRENT] appid=${appId} role=${role} path=${appPath} exists=true`);
          console.log(`[GAME_EDIT_MEDIA][PREVIEW_URL] role=${role} url=${url}`);
        }
      } else {
        previews[role] = { url: null, status: appPath ? "missing" : "unset" };
        if (DEBUG_MEDIA_EDIT && appPath) {
          console.log(`[GAME_EDIT_MEDIA][MISSING] role=${role} path=${appPath}`);
        }
      }
    }
    setRolePreviews(previews);
  }

  async function refreshRolePreview(role: MediaRole) {
    const resolved = await resolveGameMediaPaths(appId);
    if (!resolved) {
      setRolePreviews((prev) => ({
        ...prev,
        [role]: { url: null, status: "unset" },
      }));
      return;
    }
    const key = ROLE_TO_PATH_KEY[role];
    const absPath = resolved[key];
    if (absPath && typeof absPath === "string") {
      const url = localPathToUrl(absPath);
      setRolePreviews((prev) => ({
        ...prev,
        [role]: { url, status: "set" },
      }));
      if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_MEDIA][PREVIEW_URL] role=${role} url=${url}`);
    } else {
      const appPath = appInfo?.media?.[key];
      setRolePreviews((prev) => ({
        ...prev,
        [role]: { url: null, status: appPath ? "missing" : "unset" },
      }));
      if (DEBUG_MEDIA_EDIT && appPath) console.log(`[GAME_EDIT_MEDIA][MISSING] role=${role} path=${appPath}`);
    }
  }

  function getPreviewStatus(role: MediaRole): RolePreviewStatus {
    return rolePreviews[role]?.status ?? "loading";
  }

  function getPreviewUrl(role: MediaRole): string | null {
    return rolePreviews[role]?.url ?? null;
  }

  // ── Source availability checks ──

  const sourceAvailability = useMemo(() => ({
    sgdb: !!(settings?.steamGridDbApiKey && settings?.steamGridDbArtworkEnabled),
    igdb: !!(settings?.igdbClientId && settings?.igdbClientSecret),
    rawg: !!(settings?.rawgApiKey),
    steam: !!(metadata?.capsule_image || metadata?.header_image || metadata?.library_hero_image || metadata?.library_logo_image),
  }), [settings, metadata]);

  if (!open) return null;

  const currentPath = (role: MediaRole): string | null => {
    const key = ROLE_TO_PATH_KEY[role];
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
        {/* Download Metadata */}
        <div className="relative flex items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-4 py-3">
          <Download className="h-4 w-4 text-(--color-accent)" />
          <span className="flex-1 text-sm text-(--color-text)">Download metadata from online sources</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMetadataMenuOpen(!metadataMenuOpen)}
              disabled={metadataDownloading}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-3.5 py-2 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {metadataDownloading ? "Downloading..." : "Download Metadata..."}
              <ChevronDown className="h-3 w-3" />
            </button>
            {metadataMenuOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-(--color-border) bg-(--color-bg) py-1 shadow-xl">
                <SourceOption
                  label="Steam"
                  icon={Globe}
                  onClick={() => handleDownloadMetadata("steam")}
                />
                <SourceOption
                  label="IGDB"
                  icon={Image}
                  disabled={!settings?.igdbClientId || !settings?.igdbClientSecret}
                  hint={!settings?.igdbClientId ? "Not configured" : undefined}
                  onClick={() => handleDownloadMetadata("igdb")}
                />
                <SourceOption
                  label="RAWG"
                  icon={Image}
                  disabled={!settings?.rawgApiKey}
                  hint={!settings?.rawgApiKey ? "Not configured" : undefined}
                  onClick={() => handleDownloadMetadata("rawg")}
                />
              </div>
            )}
          </div>
        </div>

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
            <FieldRow label="Source" value={game?.source ?? appInfo?.provider ?? (metadata ? "steam" : null)} />
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
    return (
      <div className="space-y-5">
        <FieldRow label="App ID" value={appId} />
        <FieldRow label="Source" value={game?.source ?? appInfo?.provider} />
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
        {!game && (
          <p className="mt-2 text-xs text-(--color-muted)/60">
            Install the game in LumaForge to see installation details.
          </p>
        )}
      </div>
    );
  }

  function renderActionsTab() {
    const actionButtons: { label: string; icon: typeof FolderOpen; onClick: () => void; disabled?: boolean }[] = [
      {
        label: "Open Metadata Folder",
        icon: FolderOpen,
        onClick: () => { openGameMetadataFolder(appId); onClose(); },
        disabled: false,
      },
      {
        label: "Open Media Folder",
        icon: FolderOpen,
        onClick: () => { openGameMediaFolder(appId); onClose(); },
        disabled: false,
      },
      {
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
      },
      {
        label: "Copy App ID",
        icon: Copy,
        onClick: () => {
          navigator.clipboard.writeText(appId).catch(() => {});
          showSuccess("App ID copied");
        },
        disabled: false,
      },
      {
        label: "Open Steam Page",
        icon: Globe,
        onClick: () => {
          window.open(`https://store.steampowered.com/app/${appId}`, "_blank");
          onClose();
        },
        disabled: false,
      },
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
    const screenshotCount = metadata?.screenshots?.length ?? 0;
    const movieCount = metadata?.movies?.length ?? 0;

    return (
      <div className="space-y-5">
        {MEDIA_ROLES.map(({ role, label, icon: RoleIcon, desc }) => {
          const path = currentPath(role);
          const urlExpanded = expandedUrl === role;
          const browseOpen = browseOpenFor === role;
          const isBrowsing = browsingRole === role;

          return (
            <div
              key={role}
              className="rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4"
            >
              {/* Header row */}
              <div className="flex items-start gap-4">
                {/* Preview thumbnail */}
                <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
                  {getPreviewUrl(role) ? (
                    <img
                      src={getPreviewUrl(role)!}
                      alt={label}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        img.style.display = "none";
                        if (DEBUG_MEDIA_EDIT) console.log(`[GAME_EDIT_MEDIA][IMAGE_ERROR] role=${role} src=${getPreviewUrl(role)}`);
                      }}
                    />
                  ) : (
                    <RoleIcon className="h-8 w-8 text-(--color-muted)/40" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-(--color-text)">{label}</span>
                    {getPreviewStatus(role) === "set" ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                        Set
                      </span>
                    ) : getPreviewStatus(role) === "missing" ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        Missing
                      </span>
                    ) : getPreviewStatus(role) === "loading" ? (
                      <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                        Checking…
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                        Unset
                      </span>
                    )}
                  </div>
                  {desc && (
                    <p className="mt-0.5 text-[11px] text-(--color-muted)/60">{desc}</p>
                  )}
                  {path && (
                    <p className="mt-0.5 truncate text-[11px] text-(--color-muted)">{path}</p>
                  )}
                </div>
              </div>

              {/* Hidden file input */}
              <input
                ref={(el) => { fileInputRefs.current[role] = el; }}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={() => handleFilePick(role)}
              />

              {/* Action buttons */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRefs.current[role]?.click()}
                  disabled={saving}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Choose File
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedUrl(urlExpanded ? null : role)}
                  disabled={saving}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
                >
                  <Link className="h-3.5 w-3.5" />
                  Set URL
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBrowseOpenFor(browseOpen ? null : role)}
                    disabled={saving || isBrowsing}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs font-medium text-(--color-text) transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    {isBrowsing ? "Fetching..." : "Browse"}
                  </button>
                  {browseOpen && (
                    <div className="absolute left-0 top-full z-10 mt-1 w-52 rounded-xl border border-(--color-border) bg-(--color-bg) py-1 shadow-xl">
                      <SourceOption
                        label="Current Local"
                        icon={FolderOpen}
                        disabled={!path}
                        onClick={() => handleSourcePick(role, "local")}
                      />
                      <SourceOption
                        label="Steam Original Assets"
                        icon={Globe}
                        disabled={!sourceAvailability.steam}
                        hint={!sourceAvailability.steam ? "No metadata" : undefined}
                        onClick={() => handleSourcePick(role, "steam")}
                      />
                      <SourceOption
                        label="SteamGridDB"
                        icon={Image}
                        disabled={!sourceAvailability.sgdb}
                        hint={!sourceAvailability.sgdb ? "Not configured" : undefined}
                        onClick={() => handleSourcePick(role, "sgdb")}
                      />
                      <SourceOption
                        label="IGDB"
                        icon={Image}
                        disabled={!sourceAvailability.igdb}
                        hint={!sourceAvailability.igdb ? "Configure in Settings" : undefined}
                        onClick={() => handleSourcePick(role, "igdb")}
                      />
                      <SourceOption
                        label="RAWG"
                        icon={Image}
                        disabled={!sourceAvailability.rawg}
                        hint={!sourceAvailability.rawg ? "Configure in Settings" : undefined}
                        onClick={() => handleSourcePick(role, "rawg")}
                      />
                      <div className="my-1 border-t border-(--color-border)" />
                      <SourceOption
                        label="Web Search"
                        icon={SearchIcon}
                        onClick={() => handleOpenImageSearch(role)}
                      />
                      <SourceOption
                        label="URL"
                        icon={Link}
                        onClick={() => handleSourcePick(role, "url")}
                      />
                      <SourceOption
                        label="Local File"
                        icon={Upload}
                        onClick={() => handleSourcePick(role, "file")}
                      />
                    </div>
                  )}
                </div>
                {path && (
                  <button
                    type="button"
                    onClick={() => handleRemove(role)}
                    disabled={saving}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                )}
              </div>

              {/* URL input (expandable) */}
              {urlExpanded && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={urlInputs[role] ?? ""}
                    onChange={(e) =>
                      setUrlInputs((prev) => ({ ...prev, [role]: e.target.value }))
                    }
                    placeholder="https://example.com/image.jpg"
                    className="flex-1 rounded-lg border border-(--surface-active-border) bg-white/5 px-3 py-1.5 text-xs text-(--color-text) outline-none placeholder:text-(--color-muted)/50 focus:border-(--color-accent)/50 focus:ring-2 focus:ring-(--color-accent)/20"
                  />
                  <button
                    type="button"
                    onClick={() => handleUrlDownload(role)}
                    disabled={saving || !urlInputs[role]?.trim()}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Download
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* ── Read-only: Screenshots ── */}
        {metadata && screenshotCount > 0 && (
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

        {/* ── Read-only: Trailers ── */}
        {metadata && movieCount > 0 && (
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
            Edit Game Details
            {appInfo?.name && (
              <span className="ml-2 text-sm font-normal text-(--color-muted)">
                — {appInfo.name}
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

      {imageSearchOpen && imageSearchRole && (
        <GameImageSearchDialog
          open={imageSearchOpen}
          onClose={() => { setImageSearchOpen(false); setImageSearchRole(null); }}
          appId={appId}
          gameTitle={appInfo?.name ?? game?.title ?? appId}
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

function SourceOption({
  label,
  icon: Icon,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  icon: typeof FolderOpen;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
        disabled
          ? "cursor-not-allowed text-(--color-muted)/40"
          : "cursor-pointer text-(--color-text) hover:bg-white/5"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] text-(--color-muted)/50">{hint}</span>}
    </button>
  );
}

function formatBytes(bytes?: number): string {
  if (bytes == null) return "Unknown";
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
