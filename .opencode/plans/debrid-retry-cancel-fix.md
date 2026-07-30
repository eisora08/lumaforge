# Debrid Download Retry + Cancel Fix Plan

## Bug 1: `download_file_to_dest` never checks if file exists

**Problem**: Every retry re-downloads the entire archive (multi-GB) even if the file is already on disk.

**Fix**: Add early-exist check at the top. Compute `file_name` + `dest_path` first, check if file exists with non-zero size. If yes, return Ok immediately.

**File**: `src-tauri/src/commands/debrid_installer.rs` — function `download_file_to_dest`

```rust
// Before HTTP request, compute filename and check disk
let file_name = clean_download_filename(extract_filename_from_uri(uri));
let dest_path = dest_dir.join(&file_name);
if dest_path.exists() {
    let metadata = dest_path.metadata().map_err(|e| format!("..."))?;
    if metadata.len() > 0 {
        println!("[DEBRID][DOWNLOAD] File already exists, skipping download: {} ({} bytes)", file_name, metadata.len());
        let bytes_read = metadata.len();
        // Re-emit progress to 55%
        emit_installer_progress(app_handle, job_id, "downloading", 55, bytes_read, bytes_read, "Already downloaded");
        return Ok(DownloadedFile { path: dest_path, bytes_read, total_bytes: bytes_read });
    }
}
```

## Bug 2: Archive deleted after extraction, before install

**Problem**: Lines 327 and 447 call `fs::remove_file` to delete the RAR/ZIP archive after extraction. If the installer then fails, the archive is gone → retry must re-download.

**Fix**: Remove both `fs::remove_file` calls. Keep the archive on disk.

**File**: `src-tauri/src/commands/debrid_installer.rs`
- Line 327: Remove `let _ = fs::remove_file(&rar_path);`
- Line 447: Remove `let _ = fs::remove_file(&downloaded.path);`

## Bug 3: No short-circuit for already-extracted files

**Problem**: After extraction succeeds with `needs-setup`, if user navigates away and comes back (or retry), the code always starts from download → extract → scan, even though files are already on disk.

**Fix**: At the start of `download_debrid_package`, before calling `download_file_to_dest`, check if `dest_dir` already has files:
1. Check if an installer exe exists → return `needs-setup` immediately
2. Check if a game exe exists → return `ready` immediately

**File**: `src-tauri/src/commands/debrid_installer.rs` — inside `download_debrid_package`, before Step 1 (download)

```rust
// ── Step 0: Short-circuit if already extracted ──
// Check if dest_dir has a setup.exe or game.exe from a previous extraction
let installer_name = find_installer_exe_in_dir(&dest_path);
if let Some(ref name) = installer_name {
    let installer_path = dest_path.join(name);
    println!("[DEBRID][SHORTCIRCUIT] Installer already on disk: {}", installer_path.display());
    return Ok(DebridDownloadResult {
        success: true,
        status: "needs-setup".to_string(),
        install_dir: dest_dir.clone(),
        executable_path: None,
        installer_path: Some(installer_path.to_string_lossy().to_string()),
        message: "Already extracted. Run setup when ready.".to_string(),
    });
}

let game_exe = find_largest_exe_in_dir(&dest_path);
if let Some(exe_name) = game_exe {
    let exe_path = dest_path.join(&exe_name).to_string_lossy().to_string();
    println!("[DEBRID][SHORTCIRCUIT] Game executable already on disk: {}", exe_path);
    return Ok(DebridDownloadResult {
        success: true,
        status: "ready".to_string(),
        install_dir: dest_dir.clone(),
        executable_path: Some(exe_path),
        installer_path: None,
        message: "Already extracted. Ready to play.".to_string(),
    });
}
```

## Bug 4: Cancel button doesn't abort the HTTP download

**Problem**: `cancelJob()` only sets `status: "cancelled"` in React state. The Rust `download_debrid_package` continues downloading gigabytes in the background.

**Fix (2 parts)**:

### Part A — Rust: cancellation flag + cancel command

Add module-level cancellation tracker + `cancel_debrid_download` command.

**File**: `src-tauri/src/commands/debrid_installer.rs`

```rust
fn cancelled_jobs() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_job_cancelled(job_id: &str) -> bool {
    cancelled_jobs().lock().unwrap().contains(job_id)
}

#[tauri::command]
pub fn cancel_debrid_download(job_id: String) -> Result<(), String> {
    cancelled_jobs().lock().unwrap().insert(job_id.clone());
    println!("[DEBRID][CANCEL] Cancelled: {}", job_id);
    Ok(())
}
```

Modify `download_file_to_dest` to accept `job_id: &str` parameter and check cancellation in the streaming loop:

```rust
// In the streaming loop, after each chunk:
while let Some(chunk_result) = stream.next().await {
    // Check for cancellation
    if is_job_cancelled(cancelled_job_id) {
        drop(file);
        let _ = fs::remove_file(&dest_path);
        let _ = fs::remove_dir(&tmp_dir);
        println!("[DEBRID][CANCEL] Download aborted by user: {}", file_name);
        return Err("Download cancelled by user.".to_string());
    }
    // ... rest of loop
}
```

Also modify `download_debrid_package` to pass `&job_id` to `download_file_to_dest` calls.

### Part B — TS: Cancel button fires Rust command

**File**: `src/services/tauri.ts` — add binding:
```typescript
export async function cancelDebridDownload(jobId: string): Promise<void> {
  await invoke("cancel_debrid_download", { jobId });
}
```

**File**: `src/context/DownloadQueueContext.tsx` — modify `cancelJob`:
```typescript
async function cancelJob(jobId: string) {
  updateJob(jobId, { status: "cancelled", error: "Cancelled by user" });
  // Also abort the Rust download for debird jobs
  try {
    await cancelDebridDownload(jobId);
  } catch (e) {
    console.warn("[DOWNLOAD][CANCEL] Failed to abort Rust download:", e);
  }
}
```

### Part C — Register command in lib.rs

**File**: `src-tauri/src/lib.rs` — add `cancel_debrid_download` to invoke handlers.

## Summary of files changed

| File | Changes |
|------|---------|
| `src-tauri/src/commands/debrid_installer.rs` | Add imports, cancellation helper, `cancel_debrid_download` command, Bug 1 exist-check, Bug 2 remove fs::remove_file, Bug 3 short-circuit, Bug 4 cancel check in stream |
| `src-tauri/src/lib.rs` | Register `cancel_debrid_download` |
| `src/services/tauri.ts` | Add `cancelDebridDownload` binding |
| `src/context/DownloadQueueContext.tsx` | Wire cancel button to Rust |
