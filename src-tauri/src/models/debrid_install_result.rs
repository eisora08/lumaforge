use serde::Serialize;

/// Result from download_debrid_package — download + extract (ZIP/RAR) or save (EXE/SFX).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridDownloadResult {
    pub success: bool,
    /// "ready" = game executable found → ready to play
    /// "needs-setup" = extraction complete, setup.exe ready to run
    /// "installing" = installer is currently running (check installer_pid)
    pub status: String,
    pub install_dir: String,
    /// Present when status == "ready"
    pub executable_path: Option<String>,
    /// Present when status == "needs-setup" or "installing" — path to setup.exe
    pub installer_path: Option<String>,
    /// PID of the running installer process (present when status == "installing")
    pub installer_pid: Option<u32>,
    pub message: String,
}

/// Result from verify_debrid_installation — check if game .exe exists.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebridVerifyResult {
    pub installed: bool,
    pub install_dir: String,
    pub executable_path: Option<String>,
}

/// Result from check_installer_status — poll an installer process.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerCheckResult {
    /// "running" = installer process still alive
    /// "ready" = installer done, game executable found
    /// "needs-path" = installer done, no game executable found
    pub status: String,
    /// Present when status == "ready"
    pub executable_path: Option<String>,
    /// Present on error
    pub error: Option<String>,
}
