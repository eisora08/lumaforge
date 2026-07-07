use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::{Command, Stdio};
use sysinfo::{PidExt, ProcessExt, System, SystemExt};

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
      name != "steamapps" && name != "common" && !name.starts_with('.')
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
      || lower_name == "unitycrashhandler.exe"
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

#[tauri::command]
pub fn launch_executable(path: String) -> Result<SpawnResult, String> {
  let child = Command::new(&path)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .stdin(Stdio::null())
    .spawn()
    .map_err(|e| format!("Failed to launch executable: {}", e))?;

  let pid = child.id();
  std::mem::forget(child);

  Ok(SpawnResult {
    pid: Some(pid),
    launched: true,
  })
}

#[tauri::command]
pub fn terminate_process(pid: u32) -> Result<(), String> {
  let output = Command::new("taskkill")
    .args(["/PID", &pid.to_string(), "/F"])
    .output()
    .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

  if output.status.success() {
    Ok(())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("not found") || stderr.contains("no running") {
      return Ok(());
    }
    Err(format!("Failed to terminate process {}: {}", pid, stderr))
  }
}

#[tauri::command]
pub fn terminate_process_tree(pid: u32) -> Result<(), String> {
  let output = Command::new("taskkill")
    .args(["/PID", &pid.to_string(), "/F", "/T"])
    .output()
    .map_err(|e| format!("Failed to execute taskkill tree: {}", e))?;

  if output.status.success() {
    Ok(())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("not found") || stderr.contains("no running") {
      return Ok(());
    }
    Err(format!("Failed to terminate process tree {}: {}", pid, stderr))
  }
}

#[tauri::command]
pub fn terminate_process_by_name(name: String) -> Result<(), String> {
  let output = Command::new("taskkill")
    .args(["/IM", &name, "/F", "/T"])
    .output()
    .map_err(|e| format!("Failed to execute taskkill by name: {}", e))?;

  if output.status.success() {
    Ok(())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("not found") || stderr.contains("no running") {
      return Ok(());
    }
    Err(format!("Failed to terminate process by name '{}': {}", name, stderr))
  }
}

#[tauri::command]
pub fn is_process_running(pid: u32) -> Result<bool, String> {
  let output = Command::new("tasklist")
    .args(["/FI", &format!("PID eq {}", pid), "/NH"])
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
