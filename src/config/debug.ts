// ── Debug Configuration ──────────────────────────────────────────
// Centralized master toggle for all debug logging.
// In production (npm run tauri build), DEV_MODE is false → all logs off.
// In development (npm run tauri dev), DEV_MODE is true → individual flags apply.

const DEV_MODE = import.meta.env.DEV;

// Master switch — set to true to enable ALL debug logs (even in prod)
export const DEBUG_MASTER = false;

// ── Per-module flags ─────────────────────────────────────────────
// Only effective when DEV_MODE is true OR DEBUG_MASTER is true.

// Achievements
export const DEBUG_ACH_VERBOSE = DEV_MODE && false;
export const DEBUG_ACH_SCHEMA = DEV_MODE && false;
export const DEBUG_ACH_STATS = DEV_MODE && false;
export const DEBUG_ACH_MIGRATION = DEV_MODE && false;
export const DEBUG_ACH_CACHE_IO = DEV_MODE && false;
export const DEBUG_ACH_DIAG = false; // was true — set to false for release
export const DEBUG_ACH_LIBRARYCACHE = DEV_MODE && false;
export const DEBUG_ACH_WATCHER = DEV_MODE && false;
export const DEBUG_ACH_IMAGE_QUEUE = DEV_MODE && false;
export const DEBUG_ACH_ENGINE = DEV_MODE && false;
export const DEBUG_ACH_STORE = DEV_MODE && false;
export const DEBUG_ACH_DETAILS = DEV_MODE && false;

// Boot / startup
export const DEBUG_BOOTSTRAP = DEV_MODE && false;
export const DEBUG_BOOTSNAPSHOT = DEV_MODE && false;
export const DEBUG_BOOT_SNAPSHOT_MEDIA = DEV_MODE && false;
export const DEBUG_RENDER_SUMMARY = DEV_MODE && false;

// Media / artwork
export const DEBUG_MEDIA_DETAILS = DEV_MODE && false;
export const DEBUG_MEDIA_RESOLVE = DEV_MODE && false;
export const DEBUG_MEDIA_ROLE_MAP = DEV_MODE && false;
export const DEBUG_MEDIA_QUEUE = DEV_MODE && false;
export const DEBUG_MEDIA_CACHE = DEV_MODE && false;
export const DEBUG_MEDIA_EDIT = DEV_MODE && false;
export const DEBUG_MATERIALIZE = DEV_MODE && false;
export const DEBUG_MEDIA_GRID = DEV_MODE && false;

// Store / catalog
export const DEBUG_STORE_RENDER_VERBOSE = DEV_MODE && false;
export const DEBUG_STORE_BADGE_DECISIONS = DEV_MODE && false;
export const DEBUG_STORE_DISCOVERY = DEV_MODE && false;
export const DEBUG_STORE_DETAILS_BOUNDARY = DEV_MODE && false;
export const DEBUG_STORE_CATALOG = DEV_MODE && false;
export const DEBUG_CATALOG_ORCHESTRATOR = DEV_MODE && false;
export const DEBUG_SECTION_DECISION = DEV_MODE && false;
export const DEBUG_CURATED_CATALOG = DEV_MODE && false;
export const DEBUG_RAWG_CATALOG = DEV_MODE && false;
export const DEBUG_HOME_CATALOG = DEV_MODE && false;

// Providers / sources
export const DEBUG_SOURCE_RESOLUTION = DEV_MODE && false;
export const DEBUG_SOURCE_CACHE = DEV_MODE && false;
export const DEBUG_PROVIDER_STATUS_WRITES = DEV_MODE && false;

// Console mode
export const DEBUG_CONSOLE_MODE = DEV_MODE && false;
export const DEBUG_CONSOLE_PLAY = DEV_MODE && false;
export const DEBUG_CONSOLE_GRID_NAV = DEV_MODE && false;
export const DEBUG_CONSOLE_SEARCH_NAV = DEV_MODE && false;
export const DEBUG_CONSOLE_HUD = DEV_MODE && false;
export const DEBUG_CONSOLE_SETTINGS = DEV_MODE && false;
export const DEBUG_CONSOLE_ENTRY = DEV_MODE && false;
export const DEBUG_CONSOLE_ACTIONS = DEV_MODE && false;
export const DEBUG_CONSOLE_ACH = DEV_MODE && false;
export const DEBUG_CONSOLE_REVIEW = DEV_MODE && false;
export const DEBUG_CONSOLE_GAMEPAD = DEV_MODE && false;

// Debrid
export const DEBUG_DEBRID_LIBRARY = DEV_MODE && false;
export const DEBUG_DEBRID_LAUNCH = DEV_MODE && false;
export const DEBUG_DEBRID_INSTALL = DEV_MODE && false;

// Epic
export const DEBUG_EPIC_LIBRARY = DEV_MODE && false;
export const DEBUG_EPIC_LAUNCH = DEV_MODE && false;
export const DEBUG_EPIC_SURFACES = DEV_MODE && false;
export const DEBUG_EPIC_CONSOLE_MEDIA = DEV_MODE && false;

// Extensions / Lua
export const DEBUG_EXTENSIONS = DEV_MODE && false;
export const DEBUG_LOADER = DEV_MODE && false;
export const DEBUG_LUA_ADAPTER = DEV_MODE && false;
export const DEBUG_LUA_ACTIONS = DEV_MODE && false;
export const DEBUG_LUA_DELETE = DEV_MODE && false;
export const DEBUG_SOURCE_MANAGER = DEV_MODE && false;

// Dashboard
export const DEBUG_DASH_FEATURED = DEV_MODE && false;
export const DEBUG_DASH_RECOMMEND = DEV_MODE && false;
export const DEBUG_DASH_TOP_PICKS = DEV_MODE && false;
export const DEBUG_DASH_NEW = DEV_MODE && false;
export const DEBUG_DASH_SECTION_LOGS = DEV_MODE && false;
export const DEBUG_DASH_GLOBAL_MEDIA = DEV_MODE && false;
export const DEBUG_DASH_MEDIA = DEV_MODE && false;
export const DEBUG_DASHBOARD_MEDIA = DEV_MODE && false;
export const DEBUG_CONTINUE_PLAY = DEV_MODE && false;

// Manual games
export const DEBUG_MANUAL_COVER = DEV_MODE && false;
export const DEBUG_MANUAL_REMOVE = DEV_MODE && false;
export const DEBUG_MANUAL_METADATA = DEV_MODE && false;
export const DEBUG_MANUAL_META = DEV_MODE && false;

// Misc
export const DEBUG_FULLSCREEN = DEV_MODE && false;
export const DEBUG_LIBRARY_NAVIGATION = DEV_MODE && false;
export const DEBUG_SIDEBAR_FILTER = DEV_MODE && false;
export const DEBUG_ROUTE_RENDER = DEV_MODE && false;
export const DEBUG_ROUTE_SHELL = DEV_MODE && false;
export const DEBUG_WINDOW_CONTROLS = DEV_MODE && false;
export const DEBUG_IMG_CACHE = DEV_MODE && false;
export const DEBUG_ACTIVITY = DEV_MODE && false;
export const DEBUG_PROFILE_SAVE = DEV_MODE && false;
export const DEBUG_BACKUP_RESTORE = DEV_MODE && false;
export const DEBUG_EXTERNAL_BACKUP_RUNTIME = DEV_MODE && false;
export const DEBUG_GAME_DETAILS = DEV_MODE && false;
export const DEBUG_CACHE_MOVIES_LOG = DEV_MODE && false;
export const DEBUG_NAME_SOURCE_TRACE = DEV_MODE && false;
export const DEBUG_VISIBLE = DEV_MODE && false;
export const DEBUG_PACKAGE_COMPLETION_UI = DEV_MODE && false;
export const DEBUG_AUTO_OVERLAY = DEV_MODE && false;
export const DEBUG_PREVIEW = DEV_MODE && false;
export const DEBUG_PREVIEW_PIPE = DEV_MODE && false;
export const DEBUG_HLS = DEV_MODE && false;
export const SHOW_ACH_DEBUG_BUTTONS = DEV_MODE && false;

// Launcher mode flags
export const DEBUG_WINDOW_CONTROLS_FLAG = DEV_MODE && false;

// Feature flags (kept as-is — these are functional, not just logging)
export const DEBUG_FEATURE_FLAGS = DEV_MODE && false;
