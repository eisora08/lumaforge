use serde::Serialize;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize)]
pub struct SpawnResult {
  pub pid: Option<u32>,
  pub launched: bool,
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
  // Detach the child process — the process continues running independently
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
    Err(format!("Failed to terminate process {}: {}", pid, stderr))
  }
}

#[tauri::command]
pub fn is_process_running(pid: u32) -> Result<bool, String> {
  let output = Command::new("tasklist")
    .args(["/FI", &format!("PID eq {}", pid), "/NH"])
    .output()
    .map_err(|e| format!("Failed to query process: {}", e))?;

  let stdout = String::from_utf8_lossy(&output.stdout);
  Ok(stdout.contains(&pid.to_string()))
}
