## Session — GRAND PHASE 2 (Rust): Lua Engine Wrapper + Generic Extension Lifecycle

### Goal
Build the foundational Lua extension runtime in Rust: a sandboxed Lua engine that loads `extension.lua` files and runs their lifecycle functions (detect, install, enable, disable, uninstall), with `lumaforge.*` API functions mapped to existing backend primitives. No frontend changes — Rust backend only.

### Audit finding
**No Lua runtime crate existed in the project.** The existing "Lua" infrastructure (src-tauri/src/commands/lua.rs) treats `.lua` files as opaque filesystem blobs — scan, enable/disable via rename, delete. No parsing, no execution, no sandbox, no `lumaforge.*` API.

### Part 1: mlua crate added
- `src-tauri/Cargo.toml` — added `mlua = { version = "0.10", features = ["lua54", "vendored"] }` (vendored Lua 5.4 — no system dep needed)

### Part 2: Lua Engine module (`src-tauri/src/lua_engine/`)
- `mod.rs` — **new** — Public API: `LuaEngine` struct, `LuaEngineConfig`, `LuaExtensionResult`, `LuaExtensionFunction`, `LuaExtensionTable`
  - `LuaEngine::new(config)` — Creates sandboxed `mlua::Lua` instance, registers all `lumaforge.*` API functions, loads and evaluates `extension.lua`
  - `get_function(name)` — Returns a typed Rust closure for a lifecycle function extracted from the Lua table
  - Sandboxing: `require`/`loadfile`/`dofile`/`io`/`os`/`package` removed from globals; memory limit via `set_memory_limit(mb)`; hook-based instruction limit via `set_instruction_limit(n)`
  - `lumaforge.file_exists(path)` → calls existing `extension_file_exists` (reused from extension.rs)
  - `lumaforge.file_status(path)` → calls existing `extension_file_status`
  - `lumaforge.rename_file(from, to)` → calls existing `extension_rename_file`
  - `lumaforge.copy_file(from, to)` → calls existing `extension_copy_file`
  - `lumaforge.remove_file(path)` → calls existing `extension_remove_file`
  - `lumaforge.create_dir(path)` → calls existing `extension_create_dir`
  - `lumaforge.list_directory(path)` → calls existing `extension_list_directory`
  - `lumaforge.download_file(url, target)` → calls existing `extension_download_file`
  - `lumaforge.extract_zip(zip, dir, files)` → calls existing `extension_extract_zip`
  - `lumaforge.run_process(exe, args)` → calls existing `extension_run_process`
  - `lumaforge.fetch_url(url)` → calls existing `extension_fetch_url_as_text`
  - `lumaforge.find_largest_exe(dir)` → calls existing `extension_find_largest_exe`
  - `lumaforge.write_text_file(path, content)` → calls existing `extension_write_text_file`
  - `lumaforge.log(level, message)` → Console log from Lua
  - `lumaforge.get_app_data_dir()` → Returns app data directory path
  - `lumaforge.get_extension_dir(id)` → Returns extension-specific directory path
  - All API functions return proper error messages on failure
  - Extension table is extracted via `serde` deserialization into `LuaExtensionTable`

### Part 3: Extension Lifecycle Commands (`src-tauri/src/commands/extension_lifecycle.rs`)
- **new** — 6 Tauri commands wrapping the Lua Engine:
  - `load_extension(extension_id, script_path)` → Creates `LuaEngine`, loads `extension.lua`, extracts table, caches engine in-memory
  - `call_extension_detect(extension_id, install_dir)` → Calls `extension.detect(install_dir)`, returns result
  - `call_extension_install(extension_id, install_dir)` → Calls `extension.install(install_dir)`, returns result
  - `call_extension_enable(extension_id, install_dir)` → Calls `extension.enable(install_dir)`, returns result
  - `call_extension_disable(extension_id, install_dir)` → Calls `extension.disable(install_dir)`, returns result
  - `call_extension_uninstall(extension_id, install_dir)` → Calls `extension.uninstall(install_dir)`, returns result
  - Module-level `ENGINES: DashMap<String, LuaEngine>` cache — engines persist for session lifetime
  - All commands return `Result<LuaFunctionResult, String>` with `{success, value, error}` shape
  - `LuaFunctionResult` serializable struct

### Part 4: Module + command registration
- `src-tauri/src/commands/mod.rs` — `pub mod extension_lifecycle;` added
- `src-tauri/src/lua_engine/mod.rs` — module declared
- `src-tauri/src/lib.rs` — `mod lua_engine;`, 6 lifecycle commands registered

### Key Decisions
- **Session-cached engines**: `DashMap<String, LuaEngine>` avoids re-loading/re-evaluating `extension.lua` on every call. Engine is created once, functions extracted once, and cached until app restart.
- **Sandbox strictness**: No `io`, `os`, `package`, `require`, `loadfile`, `dofile` — only `lumaforge.*` and vanilla Lua stdlib (string, table, math, etc.). Instruction limit and memory limit enforced.
- **Existing primitives reused**: All `lumaforge.*` functions delegate to existing `extension_*` commands — no filesystem rewrite.
- **No frontend yet**: Build is Rust-only; TS bindings and frontend integration deferred.

### Key Files Created/Changed
- `src-tauri/Cargo.toml` — `mlua = { version = "0.10", features = ["lua54", "vendored"] }` added
- `src-tauri/src/lua_engine/mod.rs` — **new** — LuaEngine, sandboxing, lumaforge.* API (423 lines)
- `src-tauri/src/commands/extension_lifecycle.rs` — **new** — 6 lifecycle Tauri commands + DashMap cache (269 lines)
- `src-tauri/src/commands/mod.rs` — `pub mod extension_lifecycle;` added
- `src-tauri/src/lib.rs` — `mod lua_engine;`, 6 commands registered

### Build
- `cargo check` ✅ 0 errors
