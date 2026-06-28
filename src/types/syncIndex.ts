export type SyncIndexItemStatus =
  | "up-to-date"
  | "update-available"
  | "not-synced"
  | "failed";

export type SyncIndexItem = {
  appId: string;
  sourceKey: string;
  providerId: string;
  providerName: string;
  fileType: string;
  installedPath: string;
  lastDownloadUrl: string;
  remoteHash?: string;
  localHash?: string;
  etag?: string;
  lastModified?: string;
  installedAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  status: SyncIndexItemStatus;
};

export type SyncIndex = {
  version: number;
  items: Record<string, SyncIndexItem>;
};

export type SyncCheckResult = {
  appId: string;
  status: string;
  hasUpdate: boolean;
  message: string;
};
