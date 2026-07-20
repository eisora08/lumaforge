/**
 * Extension Framework — Barrel Export
 *
 * Re-exports all public types, interfaces, and functions from the framework.
 * External code should import from this module or from specific sub-modules.
 */

// Types — Specification
export type {
  SchemaVersion,
  ExtensionId,
  ExtensionName,
  SemVer,
  Permission,
  PermissionEntry,
  Capability,
  CapabilityEntry,
  FileReplaceStrategy,
  FileBackupStrategy,
  FileValidationStrategy,
  ManagedFileDescriptor,
  InstallStrategyType,
  InstallStrategy,
  ToggleStrategyType,
  ToggleStrategy,
  UpdateStrategyType,
  UpdateStrategy,
  ReleaseProviderType,
  ReleaseProviderRef,
  GitHubReleaseProviderConfig,
  HttpReleaseProviderConfig,
  ExtensionManifestV1,
  ExtensionBehavior,
  CriteriaDeclaration,
  DetectionCriteria,
  FilesPresenceCriteria,
  ExtensionValidation,
  ExtensionStatus,
  ExtensionOperation,
  ExtensionDetectionResult,
  ExtensionVersionInfo,
  ExtensionOperationOptions,
  ExtensionOperationResult,
  Extension,
  RepositoryExtensionEntry,
  RepositoryIndex,
  SourceType,
  ExtensionSourceConfig,
  ValidationRule,
  VALIDATION_PATTERNS,
  MAX_LENGTHS,
} from "./types";

// Errors
export {
  ExtensionError,
  ManifestParseError,
  ManifestValidationError,
  SchemaVersionUnsupportedError,
  SourceLoadError,
  RepositoryIndexError,
} from "./errors";

// Manifest Loader
export {
  loadManifestFromString,
  loadManifestFromObject,
} from "./manifests";

// Registry (legacy — prefer ExtensionManager)
export {
  registerExtension,
  unregisterExtension,
  getExtension,
  hasExtension,
  getAllExtensions,
  getExtensionCount,
  getAllManifests,
  registerExtensions,
  clearRegistry,
} from "./registry";

// Extension Manager
export type {
  RegisteredExtension,
  ExtensionManagerSnapshot,
  ExtensionSurface,
} from "./manager";
export {
  subscribeExtensionManager,
  getExtensionManagerSnapshot,
  registerLoadedExtension,
  unregisterLoadedExtension,
  getRegisteredExtension,
  listExtensions,
  getExtensionsBySurface,
  getRegisteredExtensionCount,
  clearExtensionManager,
} from "./manager";

// Sources
export type {
  ExtensionSource,
  SourceExtension,
  SourceQueryResult,
} from "./sources";
export { BuiltInSource } from "./sources/builtin";
export { RepositorySource } from "./sources/repository";
export type { RepositorySourceConfig } from "./sources/repository";

// Source Manager
export {
  registerSource,
  getSources,
  discoverAllSources,
  resetSourceManager,
} from "./sources/manager";

// Repository Loader
export type {
  RepositoryLoadResult,
} from "./repository";
export {
  parseRepositoryIndex,
  loadRepositoryIndexFromString,
  resolveEntryManifest,
  loadRepositoryManifests,
} from "./repository";

// Bootstrap
export type {
  BootstrapResult,
} from "./bootstrap";
export {
  bootstrapExtensions,
  isBootstrapped,
  resetBootstrap,
} from "./bootstrap";

// Release Providers (interfaces only)
export type {
  ReleaseAsset,
  Release,
  ReleaseFetchResult,
  ReleaseProvider,
} from "./providers";

// Runtime (Transactions — interfaces only)
export type {
  TransactionStep,
  Transaction,
  TransactionResult,
  TransactionExecutor,
} from "./runtime";

// Runtime — Types
export type {
  ExtensionRuntimeStatus,
  ExtensionRuntimeRecord,
  ExtensionRuntimeSnapshot,
  EnabledStatePersistence,
} from "./runtime";
export {
  InMemoryEnabledState,
} from "./runtime";

// Runtime — Criteria Evaluator
export type {
  GameContext,
  CriteriaEvaluationResult,
} from "./runtime";
export {
  evaluateManifestCriteria,
  filterMatchingManifests,
} from "./runtime";

// Runtime — Store
export {
  registerExtensionRuntime,
  unregisterExtensionRuntime,
  enableExtension,
  disableExtension,
  setResolvedContributions,
  getExtensionRuntime,
  getAllExtensionRuntimes,
  snapshot,
  addListener as addRuntimeListener,
  setEnabledPersistence,
  getEnabledPersistence,
  getRuntimeVersion,
  resetRuntimeStore,
} from "./runtime";

// Runtime — Validation
export {
  validateManifest,
} from "./runtime";

// Runtime — Compatibility
export {
  evaluateCompatibility,
  getLauncherVersion,
} from "./runtime";

// Contributions
export type {
  ExtensionSurface,
  ExtensionSurfaceContribution,
  ManifestContributionSource,
} from "./contributions";
export {
  VALID_SURFACES,
  resolveContributions,
  filterActiveContributions,
  extractManifestContributionSources,
} from "./contributions";

// Tools
export {
  getApplicableTools,
  gameContextFromInstallDir,
} from "./tools/ToolManager";

// Manager — Runtime integration
export type {
  RuntimeRegistrationResult,
  ToolsProjectionItem,
} from "./manager";
export {
  registerManifestAsRuntime,
  getRuntimeStoreSnapshot,
  enableRuntimeExtension,
  disableRuntimeExtension,
  projectToolsContributions,
} from "./manager";

// Sources — Dev Fixture
export {
  DevFixtureSource,
  isDevMode,
  setDevModeOverride,
  getDevFixtureManifests,
} from "./sources/devFixture";

// Services (interfaces only)
export type {
  VersionService,
  StatusService,
  ValidationService,
  InstallerService,
  UpdateService,
} from "./services";
