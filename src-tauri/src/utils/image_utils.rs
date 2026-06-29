use std::path::Path;

/// Target dimensions per media role.
/// (max_width, max_height) — None means no constraint.
pub struct TargetSize {
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
}

/// Target sizes per media role.
pub fn target_size_for(media_type: &str) -> TargetSize {
    match media_type {
        "cover" => TargetSize { max_width: Some(810), max_height: Some(1080) },
        "background" => TargetSize { max_width: Some(1920), max_height: Some(1080) },
        "logo" => TargetSize { max_width: Some(900), max_height: None },
        "icon" => TargetSize { max_width: Some(256), max_height: Some(256) },
        "landscape" => TargetSize { max_width: Some(1280), max_height: Some(720) },
        _ => TargetSize { max_width: None, max_height: None },
    }
}

/// JPEG quality for compression.
fn jpeg_quality_for(media_type: &str) -> u8 {
    match media_type {
        "cover" => 85,
        "background" => 85,
        "landscape" => 80,
        _ => 80,
    }
}

const MAX_FILE_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

/// Process image bytes: resize (no upscale), compress, and save.
pub fn process_and_save_image(
    bytes: &[u8],
    dest_path: &Path,
    media_type: &str,
) -> Result<(), String> {
    if bytes.len() as u64 > MAX_FILE_SIZE_BYTES {
        return process_and_write(bytes, dest_path, media_type);
    }
    match process_and_write(bytes, dest_path, media_type) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::write(dest_path, bytes)
                .map_err(|e| format!("Fallback write failed: {}", e))
        }
    }
}

/// Returns true if the media role must preserve transparency (PNG).
fn preserves_alpha(media_type: &str) -> bool {
    matches!(media_type, "logo" | "icon")
}

fn process_and_write(bytes: &[u8], dest_path: &Path, media_type: &str) -> Result<(), String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Decode failed: {}", e))?;

    let target = target_size_for(media_type);
    let (orig_w, orig_h) = (img.width(), img.height());
    let (new_w, new_h) = compute_resize(orig_w, orig_h, &target);

    let processed = if new_w != orig_w || new_h != orig_h {
        img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let ext = dest_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    let has_alpha = processed.color().has_alpha();
    let keep_alpha = preserves_alpha(media_type);
    let is_png_target = ext == "png" || keep_alpha;

    if is_png_target && (has_alpha || keep_alpha) {
        // PNG with transparency — save as PNG
        let png_path = if keep_alpha && ext != "png" {
            dest_path.with_extension("png")
        } else {
            dest_path.to_path_buf()
        };
        processed.save(&png_path)
            .map_err(|e| format!("PNG save failed: {}", e))?;
        if png_path != dest_path {
            let _ = std::fs::remove_file(dest_path);
            std::fs::rename(&png_path, dest_path)
                .map_err(|e| format!("Rename to final path failed: {}", e))?;
        }
        Ok(())
    } else if is_png_target && !has_alpha && !keep_alpha {
        // PNG target but no alpha — save as JPEG (smaller)
        let jpeg_path = dest_path.with_extension("jpg");
        save_as_jpeg(&processed, &jpeg_path, jpeg_quality_for(media_type))?;
        if jpeg_path != dest_path {
            let _ = std::fs::remove_file(dest_path);
            std::fs::rename(&jpeg_path, dest_path)
                .map_err(|e| format!("Rename after PNG->JPG conversion failed: {}", e))?;
        }
        Ok(())
    } else {
        save_as_jpeg(&processed, dest_path, jpeg_quality_for(media_type))
    }
}

fn save_as_jpeg(
    img: &image::DynamicImage,
    path: &Path,
    quality: u8,
) -> Result<(), String> {
    let file = std::fs::File::create(path)
        .map_err(|e| format!("Create file failed: {}", e))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, quality);
    encoder
        .encode(
            img.as_bytes(),
            img.width(),
            img.height(),
            img.color().into(),
        )
        .map_err(|e| format!("JPEG encode failed: {}", e))
}

fn compute_resize(w: u32, h: u32, target: &TargetSize) -> (u32, u32) {
    let max_w = target.max_width.unwrap_or(u32::MAX);
    let max_h = target.max_height.unwrap_or(u32::MAX);

    if w <= max_w && h <= max_h {
        return (w, h);
    }

    let ratio_w = max_w as f64 / w as f64;
    let ratio_h = max_h as f64 / h as f64;
    let ratio = ratio_w.min(ratio_h).min(1.0);

    (
        (w as f64 * ratio).round() as u32,
        (h as f64 * ratio).round() as u32,
    )
}
