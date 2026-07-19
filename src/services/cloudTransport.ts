/**
 * Future Cloud Transport contract — interfaces only.
 *
 * Do not implement any real cloud provider.
 * The local backup format must not depend on any cloud provider.
 * This file defines the shape for future cloud integration.
 */

import { BackupManifest } from "./localBackupService";

export type CloudStatus = {
  connected: boolean;
  provider?: string;
  error?: string;
};

export type RemoteBackupSummary = {
  backupId: string;
  createdAt: string;
  sizeBytes: number;
  sections: string[];
  deviceName?: string;
};

export type CloudTransport = {
  id: string;
  displayName: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<CloudStatus>;
  listBackups(): Promise<RemoteBackupSummary[]>;
  uploadBackup(localPath: string, metadata: BackupManifest): Promise<void>;
  downloadBackup(backupId: string, destination: string): Promise<void>;
  deleteBackup(backupId: string): Promise<void>;
};

// Encryption boundary — defined, not implemented.
export const ENCRYPTION_VERSION = 1;
export const ENCRYPTION_ALGORITHM = "AES-256-GCM";
export const ENCRYPTION_KEY_STORAGE = "windows-credential-manager" as const;

export type EncryptionMetadata = {
  version: number;
  algorithm: string;
  keyId: string;
  iv?: string;
};

/**
 * Future plan:
 * - Keys stored in Windows Credential Manager (or platform equivalent)
 * - Keys NEVER stored in backup files or localStorage
 * - Local unencrypted export only when user explicitly opts in
 * - Cloud uploads always encrypted by default
 */
