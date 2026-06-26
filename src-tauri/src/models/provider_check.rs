
use serde::Serialize;

#[derive(Serialize)]
pub struct ProviderAvailabilityResult {
    pub available: bool,
    pub status_code: u16,
    pub message: String,
}
