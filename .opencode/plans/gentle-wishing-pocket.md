# Buzzheavier: native-tls to bypass Cloudflare TLS fingerprinting

## Context
Buzzheavier resolution fails with HTTP 403 on both `buzzheavier.com` and `bzzhr.co`. Cloudflare blocks reqwest's `rustls-tls` fingerprint (JA3/JA4). The webfetch tool (different TLS backend) successfully fetched `bzzhr.co`.

## Changes (2 files)

### 1. `src-tauri/Cargo.toml` — add `native-tls` feature
```toml
reqwest = { version = "0.12", features = ["blocking", "rustls-tls", "native-tls", "json", "stream", "multipart"] }
```
Both features coexist; per-client selection via `.use_native_tls()` / `.use_rustls_tls()`.

### 2. `src-tauri/src/commands/debrid_installer.rs` — use native-tls for buzzheavier clients
In `resolve_buzzheavier_single`, change both `Client::builder()` calls:
```rust
let landing_client = reqwest::Client::builder()
    .use_native_tls()  // ← Schannel on Windows, bypasses rustls fingerprint
    .user_agent(BUZZHEAVIER_UA)
    .timeout(std::time::Duration::from_secs(30))
    .build()?;

let dl_client = reqwest::Client::builder()
    .use_native_tls()  // ← same
    .user_agent(BUZZHEAVIER_UA)
    .timeout(std::time::Duration::from_secs(30))
    .redirect(reqwest::redirect::Policy::none())
    .build()?;
```

## Verification
- `cargo check`
- `cargo test --lib commands::debrid_installer::tests`
- Manual test with `https://bzzhr.co/6vts2foqxklr`
