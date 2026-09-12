use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_uint};
use std::path::Path;
use std::sync::OnceLock;

use libloading::Library;

// ---------------------------------------------------------------------------
// CloudRedirect FFI bindings (cr_api.h) — dynamically loaded
// ---------------------------------------------------------------------------

type FnInitCloudSave = unsafe extern "C" fn(*const c_char, Option<CR_NotifyFn>) -> bool;
type FnShutdown = unsafe extern "C" fn();
type FnSetApps = unsafe extern "C" fn(*const c_uint, c_uint);
type FnAddApp = unsafe extern "C" fn(c_uint);
type FnRemoveApp = unsafe extern "C" fn(c_uint);
type FnIsApp = unsafe extern "C" fn(c_uint) -> bool;
type FnSetAccountId = unsafe extern "C" fn(c_uint);
type FnInstallVtableHooks = unsafe extern "C" fn() -> bool;
type FnEnableStatsSync = unsafe extern "C" fn(bool, bool);
type FnNotifyAppRunning = unsafe extern "C" fn(c_uint, bool);
type FnNotifyStatsStored = unsafe extern "C" fn(c_uint);

type CR_NotifyFn = Option<unsafe extern "C" fn(c_int, *const c_char, *const c_char)>;

struct CrFns {
    _lib: Library,
    init_cloud_save: FnInitCloudSave,
    shutdown: FnShutdown,
    set_apps: FnSetApps,
    add_app: FnAddApp,
    remove_app: FnRemoveApp,
    is_app: FnIsApp,
    set_account_id: FnSetAccountId,
    install_vtable_hooks: FnInstallVtableHooks,
    enable_stats_sync: FnEnableStatsSync,
    notify_app_running: FnNotifyAppRunning,
    notify_stats_stored: FnNotifyStatsStored,
}

static CR_FNS: OnceLock<CrFns> = OnceLock::new();

// ---------------------------------------------------------------------------
// Safe Rust wrapper
// ---------------------------------------------------------------------------

/// Notification level from CloudRedirect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrNotifyLevel {
    Info,
    Warn,
    Error,
}

/// Notification sent by CloudRedirect.
#[derive(Debug, Clone)]
pub struct CrNotification {
    pub level: CrNotifyLevel,
    pub title: String,
    pub message: String,
}

/// Status of the CloudRedirect integration.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CloudRedirectStatus {
    pub initialized: bool,
    pub dll_path: Option<String>,
    pub config_path: Option<String>,
}

/// Check if `cloud_redirect.dll` exists in the Steam root directory.
pub fn dll_exists(steam_root: &Path) -> bool {
    let dll_path = steam_root.join("cloud_redirect.dll");
    dll_path.exists()
}

/// Get the path where `cloud_redirect.dll` should be placed.
pub fn dll_path(steam_root: &Path) -> std::path::PathBuf {
    steam_root.join("cloud_redirect.dll")
}

/// Load the CloudRedirect DLL and resolve all function symbols.
/// Returns an error if the DLL is missing or any symbol is unresolved.
fn load_dll(steam_root: &Path) -> Result<&'static CrFns, String> {
    if let Some(fns) = CR_FNS.get() {
        return Ok(fns);
    }

    let dll_path = steam_root.join("cloud_redirect.dll");
    let lib = unsafe { Library::new(&dll_path) }
        .map_err(|e| format!("Failed to load cloud_redirect.dll from {}: {e}", dll_path.display()))?;

    let fns = CrFns {
        init_cloud_save: *unsafe { lib.get::<FnInitCloudSave>(b"CR_InitCloudSave") }
            .map_err(|e| format!("Symbol CR_InitCloudSave not found: {e}"))?,
        shutdown: *unsafe { lib.get::<FnShutdown>(b"CR_Shutdown") }
            .map_err(|e| format!("Symbol CR_Shutdown not found: {e}"))?,
        set_apps: *unsafe { lib.get::<FnSetApps>(b"CR_SetApps") }
            .map_err(|e| format!("Symbol CR_SetApps not found: {e}"))?,
        add_app: *unsafe { lib.get::<FnAddApp>(b"CR_AddApp") }
            .map_err(|e| format!("Symbol CR_AddApp not found: {e}"))?,
        remove_app: *unsafe { lib.get::<FnRemoveApp>(b"CR_RemoveApp") }
            .map_err(|e| format!("Symbol CR_RemoveApp not found: {e}"))?,
        is_app: *unsafe { lib.get::<FnIsApp>(b"CR_IsApp") }
            .map_err(|e| format!("Symbol CR_IsApp not found: {e}"))?,
        set_account_id: *unsafe { lib.get::<FnSetAccountId>(b"CR_SetAccountId") }
            .map_err(|e| format!("Symbol CR_SetAccountId not found: {e}"))?,
        install_vtable_hooks: *unsafe { lib.get::<FnInstallVtableHooks>(b"CR_InstallVtableHooks") }
            .map_err(|e| format!("Symbol CR_InstallVtableHooks not found: {e}"))?,
        enable_stats_sync: *unsafe { lib.get::<FnEnableStatsSync>(b"CR_EnableStatsSync") }
            .map_err(|e| format!("Symbol CR_EnableStatsSync not found: {e}"))?,
        notify_app_running: *unsafe { lib.get::<FnNotifyAppRunning>(b"CR_NotifyAppRunning") }
            .map_err(|e| format!("Symbol CR_NotifyAppRunning not found: {e}"))?,
        notify_stats_stored: *unsafe { lib.get::<FnNotifyStatsStored>(b"CR_NotifyStatsStored") }
            .map_err(|e| format!("Symbol CR_NotifyStatsStored not found: {e}"))?,
        _lib: lib,
    };

    let _ = CR_FNS.set(fns);
    Ok(CR_FNS.get().unwrap())
}

/// Initialize CloudRedirect with the given Steam root path.
/// This loads the DLL and prepares it for cloud save interception.
pub fn init(steam_root: &Path) -> Result<(), String> {
    let fns = load_dll(steam_root)?;

    let steam_path = CString::new(
        steam_root.to_str().ok_or("Steam path is not valid UTF-8")?
    ).map_err(|e| format!("Failed to create CString: {e}"))?;

    unsafe {
        let result = (fns.init_cloud_save)(steam_path.as_ptr(), None);
        if result {
            Ok(())
        } else {
            Err("CR_InitCloudSave returned false".to_string())
        }
    }
}

/// Shut down CloudRedirect and release resources.
pub fn shutdown() -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe { (fns.shutdown)(); }
    Ok(())
}

/// Replace the set of namespace apps that CloudRedirect manages.
pub fn set_apps(app_ids: &[u32]) -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe {
        (fns.set_apps)(app_ids.as_ptr(), app_ids.len() as c_uint);
    }
    Ok(())
}

/// Add a single app to the CloudRedirect set.
pub fn add_app(app_id: u32) -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe { (fns.add_app)(app_id); }
    Ok(())
}

/// Remove an app from the CloudRedirect set.
pub fn remove_app(app_id: u32) -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe { (fns.remove_app)(app_id); }
    Ok(())
}

/// Check if an app is registered with CloudRedirect.
pub fn is_app(app_id: u32) -> Result<bool, String> {
    let fns = load_dll(Path::new("."))?;
    Ok(unsafe { (fns.is_app)(app_id) })
}

/// Set the Steam account ID for CloudRedirect.
pub fn set_account_id(account_id: u32) -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe { (fns.set_account_id)(account_id); }
    Ok(())
}

/// Install CloudRedirect's vtable hooks on CClientUnifiedServiceTransport.
pub fn install_vtable_hooks() -> Result<bool, String> {
    let fns = load_dll(Path::new("."))?;
    Ok(unsafe { (fns.install_vtable_hooks)() })
}

/// Enable stats sync (achievements and playtime).
pub fn enable_stats_sync(achievements: bool, playtime: bool) -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe { (fns.enable_stats_sync)(achievements, playtime); }
    Ok(())
}

/// Notify CloudRedirect that a game has started or stopped.
pub fn notify_app_running(app_id: u32, running: bool) -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe { (fns.notify_app_running)(app_id, running); }
    Ok(())
}

/// Notify CloudRedirect that stats were stored for an app.
pub fn notify_stats_stored(app_id: u32) -> Result<(), String> {
    let fns = load_dll(Path::new("."))?;
    unsafe { (fns.notify_stats_stored)(app_id); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dll_path_construction() {
        let root = Path::new("C:\\Program Files (x86)\\Steam");
        assert_eq!(dll_path(root), Path::new("C:\\Program Files (x86)\\Steam\\cloud_redirect.dll"));
    }

    #[test]
    fn test_dll_not_exists() {
        let root = Path::new("C:\\Nonexistent\\Path");
        assert!(!dll_exists(root));
    }
}
