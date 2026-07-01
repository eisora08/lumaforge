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

#[tauri::command]
pub fn focus_game_window(pid: u32) -> Result<(), String> {
    unsafe {
        let mut found: windows::Win32::Foundation::HWND =
            windows::Win32::Foundation::HWND(0);
        let mut ctx = (&mut found, pid);

        let enum_result = windows::Win32::UI::WindowsAndMessaging::EnumWindows(
            Some(enum_window_callback),
            windows::Win32::Foundation::LPARAM(
                &mut ctx as *mut _ as isize,
            ),
        );

        if enum_result.is_err() {
            return Err("Failed to enumerate windows".to_string());
        }

        if found.0 != 0 {
            if windows::Win32::UI::WindowsAndMessaging::IsIconic(found)
                .as_bool()
            {
                let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindow(
                    found,
                    windows::Win32::UI::WindowsAndMessaging::SW_RESTORE,
                );
            }
            let _ = windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(
                found,
            );
            Ok(())
        } else {
            Err(format!("No visible window found for PID {}", pid))
        }
    }
}

unsafe extern "system" fn enum_window_callback(
    hwnd: windows::Win32::Foundation::HWND,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::BOOL {
    let ctx = &mut *(lparam.0 as *mut (&mut windows::Win32::Foundation::HWND, u32));
    let mut window_pid = 0u32;
    let _ = windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
        hwnd,
        Some(&mut window_pid),
    );
    if window_pid == ctx.1 {
        if windows::Win32::UI::WindowsAndMessaging::IsWindowVisible(hwnd).as_bool() {
            *ctx.0 = hwnd;
            return windows::Win32::Foundation::FALSE;
        }
        if ctx.0 .0 == 0 {
            *ctx.0 = hwnd;
        }
    }
    windows::Win32::Foundation::TRUE
}
