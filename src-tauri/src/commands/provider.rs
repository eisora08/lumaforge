use std::collections::HashMap;

use crate::models::provider_check::ProviderAvailabilityResult;

#[tauri::command]
pub fn check_provider_availability(
    url: String,
    success_code: u16,
    unavailable_code: u16,
    headers: Option<HashMap<String, String>>,
) -> Result<ProviderAvailabilityResult, String> {
    if url.trim().is_empty() {
        return Err("La URL del provider está vacía.".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent("LumaForge/0.1.0")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Error creando cliente HTTP: {}", error))?;

    let mut head_request = client.head(&url);

    if let Some(headers) = &headers {
        for (key, value) in headers {
            head_request = head_request.header(key, value);
        }
    }

    let head_result = head_request.send();

    let response = match head_result {
        Ok(response) => response,
        Err(_) => {
            let mut get_request = client.get(&url).header("Range", "bytes=0-0");

            if let Some(headers) = &headers {
                for (key, value) in headers {
                    get_request = get_request.header(key, value);
                }
            }

            get_request
                .send()
                .map_err(|error| format!("Error consultando provider: {}", error))?
        }
    };

    let status = response.status();
    let status_code = status.as_u16();

    if status_code == success_code {
        return Ok(ProviderAvailabilityResult {
            available: true,
            status_code,
            message: "Disponible".to_string(),
        });
    }

    if status_code == unavailable_code {
        return Ok(ProviderAvailabilityResult {
            available: false,
            status_code,
            message: "No disponible en este provider".to_string(),
        });
    }

    let message = match status_code {
        401 => "No autorizado. Verifica API key o permisos.",
        403 => "Acceso bloqueado por el provider.",
        404 => "No disponible en este provider.",
        429 => "Límite de peticiones alcanzado.",
        500 => "Error interno del provider.",
        502 => "Provider temporalmente caído o Bad Gateway.",
        503 => "Provider no disponible temporalmente.",
        504 => "Provider tardó demasiado en responder.",
        _ => "Respuesta inesperada del provider.",
    };

    Ok(ProviderAvailabilityResult {
        available: false,
        status_code,
        message: format!("{} Status: {}", message, status),
    })
}