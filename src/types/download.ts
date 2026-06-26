import { PackageFileType } from "./provider";

export type DownloadStatus =
  | "queued"
  | "checking"
  | "downloading"
  | "extracting"
  | "installing"
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

  status: DownloadStatus;
  progress: number;
  bytesRead: number;
  totalBytes: number;

  createdAt: string;
  updatedAt: string;

  error?: string;
};