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
  type?: "steam-install" | "epic-install" | "lua-package" | "zip" | "manifest" | "media" | "debrid-install" | "other";
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