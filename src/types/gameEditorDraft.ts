import type { GameProviderCapabilities, MediaRole, MetadataSourceId } from "./gameProviderCapabilities";
import type { LibraryGameSource } from "./libraryGame";

export type MediaSourceOption = {
  id: string;
  label: string;
  requiresApiKey?: boolean;
  apiKeySetting?: string;
};

export type EditorAction = {
  id: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
};

export type GameEditorDraft = {
  appId?: string;
  source: LibraryGameSource;
  providerId: string;
  libraryId: string;

  name: string;
  sortingName?: string;
  genres: string[];
  developers: string[];
  publishers: string[];
  releaseDate?: string;
  description?: string;
  shortDescription?: string;
  categories: string[];
  features: string[];

  linkedSteamAppId?: string;
  linkedIgdbId?: string;

  media: {
    coverPath: string | null;
    landscapePath: string | null;
    backgroundPath: string | null;
    logoPath: string | null;
    iconPath: string | null;
  };

  executablePath?: string;
  launchArguments?: string;

  installDir?: string;
  libraryPath?: string;
  sizeOnDisk?: number;
  isInstalled: boolean;
  isPlayable: boolean;
};

export interface GameEditorAdapter {
  source: LibraryGameSource;
  capabilities: GameProviderCapabilities;

  loadDraft(game: { appId?: string; source: LibraryGameSource; id: string; [key: string]: unknown }): Promise<GameEditorDraft>;
  saveDraft(draft: GameEditorDraft): Promise<void>;

  getAvailableMediaSources(role: MediaRole): MediaSourceOption[];
  resolveMediaFromSource(role: MediaRole, sourceId: string): Promise<string | null>;
  saveMediaRole(role: MediaRole, urlOrBase64: string, draft: GameEditorDraft): Promise<void>;
  removeMediaRole(role: MediaRole, draft: GameEditorDraft): Promise<void>;
  downloadMediaRole(role: MediaRole, url: string, draft: GameEditorDraft): Promise<void>;

  getMetadataProviders(): MetadataSourceId[];
  downloadMetadata(source: MetadataSourceId, draft: GameEditorDraft): Promise<Partial<GameEditorDraft>>;
  canDownloadMetadata(): boolean;

  getAvailableActions(): EditorAction[];
  executeAction(actionId: string, draft: GameEditorDraft): Promise<void>;
}
