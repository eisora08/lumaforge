use serde::{Deserialize, Serialize};
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
