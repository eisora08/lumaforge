import { ApiProviderId, PackageFileType } from "./provider";

export type PackageSource = {
  providerId: ApiProviderId;
  providerName: string;
  fileType: PackageFileType;
  available: boolean;
  downloadUrl?: string;
  lastUpdated?: string;
  error?: string;
};

export type PackageGame = {
  appId: string;
  title: string;
  developer?: string;
  imageUrl?: string;
  platforms: string[];
  sources: PackageSource[];
};

export type PackageSearchResult = {
  query: string;
  results: PackageGame[];
};