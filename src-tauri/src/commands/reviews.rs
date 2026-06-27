use std::time::Duration;

use crate::models::steam_review_summary::SteamReviewSummary;

#[tauri::command]
pub fn resolve_steam_review_summaries(
    app_ids: Vec<u32>,
) -> Result<Vec<SteamReviewSummary>, String> {
    if app_ids.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Error creando cliente HTTP: {}", error))?;

    let mut output = Vec::new();

    for app_id in app_ids {
        let url = format!(
            "https://store.steampowered.com/appreviews/{}?json=1&language=all&purchase_type=all&filter=all&num_per_page=1",
            app_id
        );

        let response = match client.get(&url).send() {
            Ok(value) => value,
            Err(_) => {
                output.push(fallback_review_summary(app_id));
                continue;
            }
        };

        if !response.status().is_success() {
            output.push(fallback_review_summary(app_id));
            continue;
        }

        let json: serde_json::Value = match response.json() {
            Ok(value) => value,
            Err(_) => {
                output.push(fallback_review_summary(app_id));
                continue;
            }
        };

        let success = json
            .get("success")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);

        if success != 1 {
            output.push(fallback_review_summary(app_id));
            continue;
        }

        let query_summary = match json.get("query_summary") {
            Some(value) => value,
            None => {
                output.push(fallback_review_summary(app_id));
                continue;
            }
        };

        let review_score = query_summary
            .get("review_score")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);

        let review_score_desc = query_summary
            .get("review_score_desc")
            .and_then(|value| value.as_str())
            .unwrap_or("No reviews")
            .to_string();

        let total_positive = query_summary
            .get("total_positive")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);

        let total_negative = query_summary
            .get("total_negative")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);

        let total_reviews = query_summary
            .get("total_reviews")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);

        let positive_percent = if total_reviews > 0 {
            Some(((total_positive as f64 / total_reviews as f64) * 100.0).round() as u8)
        } else {
            None
        };

        output.push(SteamReviewSummary {
            app_id,
            review_score,
            review_score_desc,
            total_positive,
            total_negative,
            total_reviews,
            positive_percent,
            resolved: total_reviews > 0,
        });
    }

    output.sort_by_key(|item| item.app_id);

    Ok(output)
}

fn fallback_review_summary(app_id: u32) -> SteamReviewSummary {
    SteamReviewSummary {
        app_id,
        review_score: 0,
        review_score_desc: "N/A".to_string(),
        total_positive: 0,
        total_negative: 0,
        total_reviews: 0,
        positive_percent: None,
        resolved: false,
    }
}