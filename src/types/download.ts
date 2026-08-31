import { PackageFileType } from "./provider";
import type { DebridInstallMethod } from "../services/debridInstallChoice";

export type DownloadStatus =
  | "queued"
  | "waiting"
  | "checking"
  | "downloading"
  | "extracting"
  | "installing"
  | "paused"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled";

export type DownloadJob = {
  id: string;
  appId: string;
  gameTitle: string;
  providerId: string;
  providerName: string;
  fileType: PackageFileType;
  downloadUrl?: string;

  /** Broad category for display/grouping */
  type?: "steam-install" | "epic-install" | "lua-package" | "zip" | "manifest" | "media" | "debrid-install" | "steam-depot-download" | "other";
  /** Indeterminate when reliable percentage is unavailable */
  progressMode?: "determinate" | "indeterminate";
  speedBytesPerSec?: number;
  etaSeconds?: number;
  /** Status message shown below the title */
  message?: string;
  /** Game artwork URL for Steam install items */
  artworkUrl?: string;
  /** Links this job to a parent install item */
  parentId?: string;
  /** Installed size in bytes (populated when Steam install completes) */
  installedSize?: number;
  /** Repacker name for Debrid installs (e.g., "FitGirl", "DODI") */
  repacker?: string;
  /** Download method chosen by the user for Debrid installs */
  installMethod?: DebridInstallMethod;
  /** Preferred debrid provider when `installMethod === "debrid"` */
  debridProviderId?: string;
  /** Custom destination directory for the Debrid install (defaults to games/debrid/<providerGameId>) */
  destDir?: string;
  /** If false, download only and leave the archive on disk (game NOT marked installed) */
  autoExtract?: boolean;
  /** Remove the .rar/.zip after a successful extraction */
  deleteArchive?: boolean;
  /** Install directory on disk (populated when install completes) */
  installDir?: string;
  /** Connected peers for torrent installs (reported via installer-network) */
  peers?: number;
  /** Peers currently serving data (seeds) for torrent installs */
  seeds?: number;

  /** Depot download: selected depots for this job */
  depotSelections?: DepotSelection[];

  status: DownloadStatus;
  progress: number;
  bytesRead: number;
  totalBytes: number;

  createdAt: string;
  updatedAt: string;

  error?: string;
};


export type InstallerProgressEvent = {
  job_id: string;
  status: DownloadStatus;
  progress: number;
  bytes_read: number;
  total_bytes: number;
  message: string;
};

export type InstallerNetworkEvent = {
  job_id: string;
  peers: number;
  seeds: number;
};

// ---------------------------------------------------------------------------
// Depot Downloader types
// ---------------------------------------------------------------------------

/** Information about a single depot within a Steam app. */
export type DepotInfo = {
  depotId: number;
  name: string;
  manifestId?: string;
  sizeOnDisk?: number;
  key?: string;
  manifestPath?: string;
  encrypted: boolean;
  /** DLC app ID if this depot belongs to a DLC */
  dlcAppId?: number;
  /** Platform: "windows", "macos", "linux", or undefined for all */
  os?: string;
  /** Language if depot is language-specific */
  language?: string;
  /** Whether this is a shared redistributable (VC++, DirectX, etc.) */
  isShared: boolean;
  /** Owning app for shared depots */
  fromAppId?: number;
};

/** A depot selected for download. */
export type DepotSelection = {
  depotId: number;
  manifestId: string;
  manifestPath: string;
  size: number;
};

/** A full depot download job request. */
export type DepotDownloadJob = {
  /** Frontend-provided job ID so events map to the queue job. */
  jobId?: string;
  appId: number;
  gameName: string;
  depots: DepotSelection[];
  outputDir: string;
};

/** Result from resolving depots for an app. */
export type DepotResolveResult = {
  depots: DepotInfo[];
  gameName: string;
};

/** Depot downloader tool status. */
export type DepotDownloaderStatus = {
  installed: boolean;
  version?: string;
  exePath: string;
};