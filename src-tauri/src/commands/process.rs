use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use sysinfo::{PidExt, ProcessExt, System, SystemExt};
use tauri::{AppHandle, Manager};

/// Prevent console programs (taskkill/tasklist/powershell) from flashing a new
/// console window when spawned from a GUI release build (which has no attached
/// console). In dev the binary inherits the terminal's console so the flash is
/// invisible, but packaged apps create a fresh console per child otherwise.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Apply `CREATE_NO_WINDOW` so child console programs never flash a window.
/// No-op on non-Windows.
pub(crate) fn hide_window(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Same as [`hide_window`] but for asynchronous [`tokio::process::Command`]
/// console programs (7z, unrar, Steamless.CLI). No-op on non-Windows.
pub(crate) fn hide_window_tokio(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Calculate total size of all files in a directory recursively using walkdir.
#[tauri::command]
pub fn calculate_directory_size(path: String) -> Result<u64, String> {
    let dir = Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Directory not found: {}", path));
    }
    let total: u64 = walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .map(|m| m.len())
        .sum();
    Ok(total)
}

#[derive(Debug, Clone, Serialize)]
pub struct SpawnResult {
  pub pid: Option<u32>,
  pub launched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
  pub pid: u32,
  pub parent_pid: Option<u32>,
  pub name: String,
  pub exe: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredExecutable {
  pub exe_path: String,
  pub file_name: String,
  pub size_bytes: u64,
}

#[tauri::command]
pub fn discover_executables(dir: String) -> Result<Vec<DiscoveredExecutable>, String> {
  let dir_path = Path::new(&dir);
  if !dir_path.exists() || !dir_path.is_dir() {
    return Err(format!("Directory not found: {}", dir));
  }

  let mut results = Vec::new();
  let walker = walkdir::WalkDir::new(dir_path)
    .max_depth(3)
    .follow_links(false)
    .into_iter()
    .filter_entry(|e| {
      let name = e.file_name().to_string_lossy().to_lowercase();
      (name != "steamapps" && name != "common" && !name.starts_with('.'))
        && (name != "_redist" && name != "_commonredist")
    });

  for entry in walker {
    let entry = entry.map_err(|e| format!("Walk error: {}", e))?;
    if !entry.file_type().is_file() {
      continue;
    }

    let path = entry.path();
    let ext = path
      .extension()
      .and_then(|e| e.to_str())
      .map(|e| e.to_lowercase());

    if ext.as_deref() != Some("exe") {
      continue;
    }

    let file_name = path
      .file_name()
      .and_then(|n| n.to_str())
      .unwrap_or("")
      .to_string();

    let lower_name = file_name.to_lowercase();
    if lower_name.starts_with("setup")
      || lower_name.starts_with("unins")
      || lower_name.starts_with("unitycrashhandler")
      || lower_name.starts_with("dxsetup")
      || lower_name.starts_with("vcredist")
      || lower_name.starts_with("dotnet")
      || lower_name.starts_with("directx")
      || lower_name == "steam.exe"
      || lower_name == "steamwebhelper.exe"
      || lower_name == "epicgameslauncher.exe"
      || lower_name == "eosoverlay.exe"
      || lower_name == "eosoverlayrenderer.exe"
      || lower_name == "crashreporter.exe"
    {
      continue;
    }

    let metadata = std::fs::metadata(path)
      .map_err(|e| format!("Metadata error: {}", e))?;

    results.push(DiscoveredExecutable {
      exe_path: path.to_string_lossy().to_string(),
      file_name,
      size_bytes: metadata.len(),
    });
  }

  results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

  Ok(results)
}

/// Spawn a detached process, falling back to elevation for Windows error 740.
///
/// Game executables whose manifest requires elevation cannot be launched via
/// `CreateProcess` (what `Command::spawn` uses) from a non-elevated parent —
/// Windows returns `os error 740` ("The requested operation requires
/// elevation"). When that happens on Windows we retry via PowerShell
/// `Start-Process -Verb RunAs`, which triggers the UAC prompt and returns the
/// elevated child PID via `-PassThru`.
///
/// Returns the PID of the spawned process. The child is already detached — the
/// caller must not wait on it. Errors are propagated verbatim; a declined UAC
/// prompt is reported as `elevation declined`.
pub fn spawn_game_with_elevation_fallback(
  exe: &str,
  working_directory: Option<&str>,
  args: Option<&[String]>,
) -> Result<u32, String> {
  let trimmed = exe.trim().trim_matches(|c| c == '"' || c == '\'');
  if trimmed.is_empty() {
    return Err("launch failed: executable path is empty".to_string());
  }

  // Validate the executable actually exists on disk before spawning. A stale or
  // missing path surfaces as a cryptic `os error 2` (ERROR_FILE_NOT_FOUND) from
  // both the plain spawn AND the elevated `Start-Process -Verb RunAs` retry, so
  // fail fast with a clear message instead of dragging the user through a UAC
  // prompt that can never succeed. Relative paths are resolved against the
  // working directory when one is provided.
  let resolved_exe = if Path::new(trimmed).is_absolute() {
    trimmed.to_string()
  } else if let Some(wd) = working_directory {
    let wd_trimmed = wd.trim().trim_matches(|c| c == '"' || c == '\'');
    if wd_trimmed.is_empty() {
      trimmed.to_string()
    } else {
      Path::new(wd_trimmed).join(Path::new(trimmed)).to_string_lossy().into_owned()
    }
  } else {
    trimmed.to_string()
  };

  if !Path::new(&resolved_exe).is_file() {
    return Err(format!(
      "Executable not found: '{resolved_exe}'. The installed path may be missing or stale — reinstall the game or pick a valid executable."
    ));
  }

  let mut cmd = Command::new(trimmed);
  if let Some(wd) = working_directory {
    if !wd.trim().is_empty() {
      cmd.current_dir(wd.trim().trim_matches(|c| c == '"' || c == '\''));
    }
  }
  if let Some(a) = args {
    cmd.args(a.iter().filter(|a| !a.is_empty()));
  }
  cmd.stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null());
  hide_window(&mut cmd);

  match cmd.spawn() {
    Ok(child) => {
      let pid = child.id();
      // Detach so the process outlives our command.
      std::mem::forget(child);
      Ok(pid)
    }
    Err(e) => {
      #[cfg(not(target_os = "windows"))]
      return Err(format!("Failed to launch executable: {}", e));

      #[cfg(target_os = "windows")]
      if e.raw_os_error() != Some(740) {
        return Err(format!("Failed to launch executable: {}", e));
      }

      // Elevation required — retry via PowerShell `Start-Process -Verb RunAs`.
      // The UAC prompt is blocking: PowerShell waits for the user's choice, so
      // `.output()` returns either the elevated PID or an error.
      println!(
        "[ELEVATED_SPAWN] Elevation required (os error 740) — retrying with PowerShell RunAs"
      );
      let safe_exe = trimmed.replace('\'', "''");
      let mut ps_command = format!("Start-Process -FilePath '{}'", safe_exe);

      if let Some(wd) = working_directory {
        if !wd.trim().is_empty() {
          let safe_wd = wd
            .trim()
            .trim_matches(|c| c == '"' || c == '\'')
            .replace('\'', "''");
          ps_command.push_str(&format!(" -WorkingDirectory '{}'", safe_wd));
        }
      }

      let joined_args = args.map(|a| {
        a.iter()
          .filter(|a| !a.is_empty())
          .cloned()
          .collect::<Vec<_>>()
          .join(" ")
      });
      if let Some(j) = joined_args {
        if !j.is_empty() {
          let safe_args = j.replace('\'', "''");
          ps_command.push_str(&format!(" -ArgumentList '{}'", safe_args));
        }
      }

      ps_command.push_str(" -Verb RunAs -PassThru | Select-Object -ExpandProperty Id");

      let ps_command_ref: &str = &ps_command;
      let output = hide_window(Command::new("powershell").args([
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        ps_command_ref,
      ]))
        .output()
        .map_err(|e2| format!("Failed to launch elevated executable: {}", e2))?;

      let stdout = String::from_utf8_lossy(&output.stdout);
      let pid_str = stdout.trim();
      let pid: u32 = pid_str.parse().map_err(|_| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if output.status.success() {
          format!(
            "Could not get PID from elevated process: stdout='{}'",
            stdout
          )
        } else {
          format!("Elevation declined or failed: {}", stderr.trim())
        }
      })?;

      println!("[ELEVATED_SPAWN] Elevated detached PID={}", pid);
      Ok(pid)
    }
  }
}

#[tauri::command]
pub fn launch_executable(
  path: String,
  args: Option<Vec<String>>,
  working_dir: Option<String>,
) -> Result<SpawnResult, String> {
  let pid = spawn_game_with_elevation_fallback(
    &path,
    working_dir.as_deref(),
    args.as_deref(),
  )?;

  Ok(SpawnResult {
    pid: Some(pid),
    launched: true,
  })
}

/// Launch an executable with a **single args string** — no splitting into array.
///
/// Playnite passes the full expanded argument string directly to
/// `ProcessStartInfo.Arguments` and lets Windows handle parsing/quoting.
/// This command mirrors that behavior by building a full command line string
/// and passing it to `CreateProcessW` / `Command`, preserving quotes exactly
/// as the template defines them (e.g. `-g "{ImagePath}" -f`).
#[tauri::command]
pub fn launch_executable_str(
  path: String,
  args_str: Option<String>,
  working_dir: Option<String>,
  title: Option<String>,
) -> Result<SpawnResult, String> {
  let trimmed = path.trim().trim_matches(|c| c == '"' || c == '\'');
  if trimmed.is_empty() {
    return Err("launch failed: executable path is empty".to_string());
  }

  let resolved_exe = if Path::new(trimmed).is_absolute() {
    trimmed.to_string()
  } else if let Some(ref wd) = working_dir {
    let wd_trimmed = wd.trim().trim_matches(|c| c == '"' || c == '\'');
    if wd_trimmed.is_empty() {
      trimmed.to_string()
    } else {
      Path::new(wd_trimmed)
        .join(Path::new(trimmed))
        .to_string_lossy()
        .into_owned()
    }
  } else {
    trimmed.to_string()
  };

  if !Path::new(&resolved_exe).is_file() {
    return Err(format!(
      "Executable not found: '{resolved_exe}'."
    ));
  }

  // Build the full command line: "exe" args
  // This matches exactly how Playnite / ProcessStartInfo works.
  let cmd_line = match &args_str {
    Some(args) if !args.is_empty() => format!("\"{}\" {}", trimmed, args),
    _ => format!("\"{}\"", trimmed),
  };

  #[cfg(target_os = "windows")]
  {
    use windows::Win32::System::Threading::{CreateProcessW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW, STARTUPINFOW_FLAGS};
    use windows::core::{PCWSTR, PWSTR};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let mut cmd_line_wide: Vec<u16> = OsStr::new(&cmd_line)
      .encode_wide().chain(std::iter::once(0)).collect();
    let mut pi: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };

    // Build window title: "GameTitle - EmulatorName" or just the game title
    let title_wide: Vec<u16> = title.as_ref().map(|t| {
      OsStr::new(t).encode_wide().chain(std::iter::once(0)).collect()
    }).unwrap_or_default();

    let mut si: STARTUPINFOW = unsafe { std::mem::zeroed() };
    si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    if !title_wide.is_empty() {
      si.lpTitle = PWSTR(title_wide.as_ptr() as *mut u16);
      si.dwFlags = STARTUPINFOW_FLAGS(0x200); // STARTF_USEWINDOWTITLE
    }

    let current_dir_wide: Vec<u16> = working_dir.as_ref().map(|wd| {
      let trimmed_wd = wd.trim().trim_matches(|c| c == '"' || c == '\'');
      OsStr::new(trimmed_wd).encode_wide().chain(std::iter::once(0)).collect()
    }).unwrap_or_default();

    let pcw_current_dir = if current_dir_wide.is_empty() || working_dir.is_none() {
      PCWSTR::null()
    } else {
      PCWSTR::from_raw(current_dir_wide.as_ptr())
    };

    let result = unsafe {
      CreateProcessW(
        PCWSTR::null(),
        PWSTR(cmd_line_wide.as_mut_ptr()),
        None,
        None,
        false,
        PROCESS_CREATION_FLAGS(CREATE_NO_WINDOW),
        None,
        pcw_current_dir,
        &si,
        &mut pi,
      )
    };

    match result {
      Ok(_) => {
        let pid = pi.dwProcessId;
        unsafe {
          windows::Win32::Foundation::CloseHandle(pi.hProcess).ok();
          windows::Win32::Foundation::CloseHandle(pi.hThread).ok();
        }
        println!("[EMULATOR_LAUNCH_STR] PID={} cmd_line={}", pid, cmd_line);
        Ok(SpawnResult {
          pid: Some(pid),
          launched: true,
        })
      }
      Err(e) => {
        let err_msg = format!("CreateProcessW failed: {} (cmd: {})", e, cmd_line);
        println!("[EMULATOR_LAUNCH_STR] FAILED: {}", err_msg);
        Err(err_msg)
      }
    }
  }

  #[cfg(not(target_os = "windows"))]
  {
    // Fallback: split args and use Command
    let pid = spawn_game_with_elevation_fallback(
      &resolved_exe,
      working_dir.as_deref(),
      args_str.as_ref().map(|a| vec![a.clone()]).as_deref(),
    )?;
    Ok(SpawnResult {
      pid: Some(pid),
      launched: true,
    })
  }
}

/// Run `taskkill` with an elevated (UAC) fallback on Windows.
///
/// Plain `taskkill` cannot terminate a process that was launched elevated via
/// `ShellExecuteW` with verb `runas` (the Debrid/Manual launch path) — Windows
/// returns "Access is denied". When the plain kill fails we retry once elevated
/// via `ShellExecuteExW` with verb `runas`, which triggers UAC directly without
/// an intermediate PowerShell process.  The UAC prompt is blocking and
/// user-initiated (Stop), so the fallback only appears for genuinely elevated
/// targets.
#[cfg(target_os = "windows")]
fn kill_via_taskkill(args: Vec<String>) -> Result<(), String> {
  let plain = hide_window(Command::new("taskkill").args(&args))
    .output()
    .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

  if plain.status.success() {
    return Ok(());
  }
  let stderr = String::from_utf8_lossy(&plain.stderr);
  if stderr.contains("not found") || stderr.contains("no running") {
    return Ok(());
  }

  println!(
    "[TERMINATE] taskkill failed ({}), retrying elevated via UAC prompt",
    stderr.trim()
  );

  // ── Elevated fallback: ShellExecuteExW with verb "runas" ──
  // Replaces the previous PowerShell `Start-Process taskkill -Verb RunAs`
  // approach.  PowerShell itself was hidden via CREATE_NO_WINDOW, but the
  // *child* taskkill.exe process it spawned received its own console window —
  // producing a visible flash.  Calling ShellExecuteExW directly avoids the
  // intermediate PowerShell process entirely: the OS shows the UAC dialog,
  // then runs taskkill.exe with SW_HIDE.  No console window, no flash.
  #[cfg(target_os = "windows")]
  {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::GetExitCodeProcess;
    use winapi::um::shellapi::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOCLOSEPROCESS};
    use winapi::um::synchapi::WaitForSingleObject;
    use winapi::um::winbase::INFINITE;
    use winapi::um::winuser::SW_HIDE;

    let params: Vec<u16> = OsStr::new(&args.join(" "))
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();
    let file: Vec<u16> = OsStr::new("taskkill")
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();
    let verb: Vec<u16> = OsStr::new("runas")
      .encode_wide()
      .chain(std::iter::once(0))
      .collect();

    return unsafe {
      let mut sei: SHELLEXECUTEINFOW = std::mem::zeroed();
      sei.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
      sei.fMask = SEE_MASK_NOCLOSEPROCESS;
      sei.lpVerb = verb.as_ptr();
      sei.lpFile = file.as_ptr();
      sei.lpParameters = params.as_ptr();
      sei.nShow = SW_HIDE;

      if ShellExecuteExW(&mut sei) == 0 || sei.hProcess.is_null() {
        return Err("Failed to launch elevated taskkill".into());
      }

      WaitForSingleObject(sei.hProcess, INFINITE);
      let mut exit_code: u32 = 0;
      GetExitCodeProcess(sei.hProcess, &mut exit_code);
      CloseHandle(sei.hProcess);

      if exit_code == 0 {
        println!("[TERMINATE] elevated taskkill exit=0 (target killed)");
        Ok(())
      } else {
        Err(format!(
          "Failed to terminate process (elevated taskkill exit='{}')",
          exit_code
        ))
      }
    };
  }

}

#[cfg(not(target_os = "windows"))]
fn kill_via_taskkill(args: Vec<String>) -> Result<(), String> {
  let output = Command::new("taskkill")
    .args(&args)
    .output()
    .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

  if output.status.success() {
    Ok(())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("not found") || stderr.contains("no running") {
      return Ok(());
    }
    Err(format!("Failed to terminate process: {}", stderr))
  }
}

#[tauri::command]
pub fn terminate_process(pid: u32) -> Result<(), String> {
  kill_via_taskkill(vec![
    "/PID".to_string(),
    pid.to_string(),
    "/F".to_string(),
  ])
}

#[tauri::command]
pub fn terminate_process_tree(pid: u32) -> Result<(), String> {
  kill_via_taskkill(vec![
    "/PID".to_string(),
    pid.to_string(),
    "/F".to_string(),
    "/T".to_string(),
  ])
}

#[tauri::command]
pub fn terminate_process_by_name(name: String) -> Result<(), String> {
  kill_via_taskkill(vec![
    "/IM".to_string(),
    name,
    "/F".to_string(),
    "/T".to_string(),
  ])
}

#[tauri::command]
pub fn is_process_running(pid: u32) -> Result<bool, String> {
  let output = hide_window(Command::new("tasklist").args([
    "/FI",
    &format!("PID eq {}", pid),
    "/NH",
  ]))
  .output()
  .map_err(|e| format!("Failed to query process: {}", e))?;

  let stdout = String::from_utf8_lossy(&output.stdout);
  Ok(!stdout.contains("No tasks are running") && !stdout.trim().is_empty())
}

#[tauri::command]
pub fn list_processes() -> Result<Vec<ProcessInfo>, String> {
  let mut sys = System::new();
  sys.refresh_processes();

  let processes: Vec<ProcessInfo> = sys
    .processes()
    .iter()
    .map(|(pid, process)| {
      let exe_path = process.exe();
      let exe = if exe_path.as_os_str().is_empty() {
        None
      } else {
        Some(exe_path.to_string_lossy().to_string())
      };
      ProcessInfo {
        pid: pid.as_u32(),
        parent_pid: process.parent().map(|p| p.as_u32()),
        name: process.name().to_string(),
        exe,
      }
    })
    .collect();

  Ok(processes)
}


#[tauri::command]
pub fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| format!("Failed to delete {}: {}", path, e))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct FileMetadata {
    pub exists: bool,
    pub size: Option<u64>,
    pub modified_unix_s: Option<f64>,
    pub created_unix_s: Option<f64>,
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> FileMetadata {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return FileMetadata {
            exists: false,
            size: None,
            modified_unix_s: None,
            created_unix_s: None,
        };
    }

    match std::fs::metadata(&p) {
        Ok(meta) => {
            let modified = meta.modified().ok().map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0)
            });
            let created = meta.created().ok().map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0)
            });
            FileMetadata {
                exists: true,
                size: Some(meta.len()),
                modified_unix_s: modified,
                created_unix_s: created,
            }
        }
        Err(_) => FileMetadata {
            exists: true,
            size: None,
            modified_unix_s: None,
            created_unix_s: None,
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileFilter {
  pub name: String,
  pub extensions: Vec<String>,
}

#[tauri::command]
pub fn pick_file(title: Option<String>, filters: Option<Vec<FileFilter>>) -> Result<Option<String>, String> {
  let mut dialog = rfd::FileDialog::new();
  if let Some(t) = title {
    dialog = dialog.set_title(&t);
  }
  if let Some(f) = filters {
    for fl in &f {
      let exts: Vec<&str> = fl.extensions.iter().map(|s| s.as_str()).collect();
      dialog = dialog.add_filter(&fl.name, &exts);
    }
  }
  match dialog.pick_file() {
    Some(path) => Ok(Some(path.to_string_lossy().to_string())),
    None => Ok(None),
  }
}

#[tauri::command]
pub fn pick_folder(
  app_handle: AppHandle,
  title: Option<String>,
  start_dir: Option<String>,
) -> Result<Option<String>, String> {
  let mut dialog = rfd::FileDialog::new();
  if let Some(t) = title {
    dialog = dialog.set_title(&t);
  }
  if let Some(d) = start_dir {
    let mut p = PathBuf::from(&d);
    if !p.is_absolute() {
      // Resolve relative paths (e.g. "games/debrid/<id>") against the app data dir.
      if let Ok(dir) = app_handle.path().app_data_dir() {
        p = dir.join(&p);
      }
    }
    // When the typed directory doesn't exist yet (e.g. a not-yet-created
    // games/debrid/<id>), walk up to the nearest existing ancestor so the
    // native dialog doesn't silently fall back to the OS last-used folder.
    let mut dir = p;
    while !dir.exists() {
      if !dir.pop() {
        break;
      }
    }
    if dir.exists() {
      dialog = dialog.set_directory(&dir);
    }
  }
  match dialog.pick_folder() {
    Some(path) => Ok(Some(path.to_string_lossy().to_string())),
    None => Ok(None),
  }
}

#[tauri::command]
pub fn focus_game_window(pid: u32) -> Result<(), String> {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::*;
        use windows::Win32::Foundation::*;

        let mut found: HWND = HWND(0);
        let mut ctx = (&mut found, pid);

        EnumWindows(
            Some(enum_window_callback),
            LPARAM(&mut ctx as *mut _ as isize),
        )
        .map_err(|_| "Failed to enumerate windows".to_string())?;

        if found.0 == 0 {
            return Err(format!("No visible window found for PID {}", pid));
        }

        // Restore if minimized
        if IsIconic(found).as_bool() {
            let _ = ShowWindow(found, SW_RESTORE);
        }

        // Attempt focus with fallback
        let mut focus_ok = SetForegroundWindow(found).as_bool();
        if !focus_ok {
            let _ = ShowWindow(found, SW_RESTORE);
            focus_ok = SetForegroundWindow(found).as_bool();
        }
        if !focus_ok {
            let _ = ShowWindow(found, SW_SHOW);
            let _ = SetForegroundWindow(found);
        }

        Ok(())
    }
}

unsafe extern "system" fn enum_window_callback(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::BOOL {
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::Win32::Foundation::*;

    let ctx = &mut *(lparam.0 as *mut (&mut HWND, u32));
    let mut window_pid = 0u32;
    let _ = GetWindowThreadProcessId(hwnd, Some(&mut window_pid));

    if window_pid == ctx.1 {
        if !IsWindowVisible(hwnd).as_bool() {
            return TRUE;
        }

        // Filter out tool windows and system overlay windows
        let ex_style = GetWindowLongW(hwnd, WINDOW_LONG_PTR_INDEX(-20)) as u32;
        if (ex_style & WS_EX_TOOLWINDOW.0) != 0 || (ex_style & WS_EX_NOACTIVATE.0) != 0 {
            return TRUE;
        }

        // Check for caption bar — indicates a main application window
        let style = GetWindowLongW(hwnd, WINDOW_LONG_PTR_INDEX(-16)) as u32;
        let has_caption = (style & WS_CAPTION.0) == WS_CAPTION.0;

        // Prefer main windows (with caption). Keep first match as fallback.
        if ctx.0.0 == 0 || has_caption {
            *ctx.0 = hwnd;
            if has_caption {
                return FALSE; // stop — found the main window
            }
        }
    }
    TRUE
}
