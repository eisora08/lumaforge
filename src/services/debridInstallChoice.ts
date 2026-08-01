import type { ConfirmOptions, ConfirmResult } from "./confirmService";

/**
 * Debrid install method selection.
 *
 * A repack entry may expose several `downloadUris`:
 *  - HTTP/S direct links (gofile.io, etc.) — downloaded directly.
 *  - `magnet:` links — must be resolved through a debrid provider first,
 *    or downloaded directly by the built-in torrent client.
 *
 * When a magnet is involved the user is asked how to proceed (debrid vs
 * built-in torrent). Direct-only URIs are used without a dialog.
 */

/**
 * How a chosen `uri` should be downloaded:
 *  - `direct`  — HTTP(S) direct link, downloaded as-is.
 *  - `debrid`  — magnet resolved through a debrid provider first.
 *  - `torrent` — magnet downloaded by the built-in torrent client (librqbit).
 */
export type DebridInstallMethod = "direct" | "debrid" | "torrent";

export type DebridInstallResolution =
  | { ok: true; uri: string; method: DebridInstallMethod }
  | { ok: false; reason: "no-uri" | "cancelled" };

export function isMagnetUri(uri: string): boolean {
  return uri.startsWith("magnet:");
}

/** First non-magnet (direct HTTP) URI, or null. */
export function pickDirectDebridUri(downloadUris: string[] | undefined | null): string | null {
  if (!downloadUris?.length) return null;
  return downloadUris.find((u) => !isMagnetUri(u)) ?? null;
}

/** First magnet URI (debrid-resolvable), or null. */
export function pickMagnetDebridUri(downloadUris: string[] | undefined | null): string | null {
  if (!downloadUris?.length) return null;
  return downloadUris.find(isMagnetUri) ?? null;
}

/**
 * Non-interactive policy for surfaces that cannot show a confirm dialog
 * (e.g. Console Mode action handlers): direct URI preferred, magnet fallback.
 */
export function pickInstallUriWithoutDialog(downloadUris: string[] | undefined | null): string | null {
  return pickDirectDebridUri(downloadUris) ?? pickMagnetDebridUri(downloadUris);
}

/**
 * Decide the download URI for a repack install.
 *
 *  - No URIs              -> { ok: false, reason: "no-uri" }
 *  - Direct only          -> direct URI (no dialog)
 *  - Magnet only          -> asks the user (debrid | torrent | cancel)
 *  - Both                 -> asks the user (direct | debrid | torrent | cancel)
 */
export async function resolveDebridInstallUri(
  downloadUris: string[] | undefined | null,
  confirm: (options: ConfirmOptions) => Promise<ConfirmResult>,
  gameTitle: string,
): Promise<DebridInstallResolution> {
  const direct = pickDirectDebridUri(downloadUris);
  const magnet = pickMagnetDebridUri(downloadUris);

  if (!direct && !magnet) return { ok: false, reason: "no-uri" };

  if (direct && magnet) {
    const result = await confirm({
      title: "Método de descarga",
      description: `"${gameTitle}" tiene descarga directa (HTTP) y una resolución a través de Debrid disponibles. ¿Cómo quieres descargarlo?`,
      confirmLabel: "Descarga directa",
      cancelLabel: "Cancelar",
      secondaryLabel: "Resolver con Debrid",
      secondaryVariant: "info",
      tertiaryLabel: "Descargar vía torrent",
    });
    if (result.tertiary) return { ok: true, uri: magnet, method: "torrent" };
    if (result.secondary) return { ok: true, uri: magnet, method: "debrid" };
    if (result.confirmed) return { ok: true, uri: direct, method: "direct" };
    return { ok: false, reason: "cancelled" };
  }

  if (magnet) {
    const result = await confirm({
      title: "Método de descarga",
      description: `"${gameTitle}" solo tiene un enlace magnet disponible. ¿Cómo quieres descargarlo?`,
      confirmLabel: "Resolver con Debrid",
      cancelLabel: "Cancelar",
      tertiaryLabel: "Descargar vía torrent",
    });
    if (result.tertiary) return { ok: true, uri: magnet, method: "torrent" };
    if (result.confirmed) return { ok: true, uri: magnet, method: "debrid" };
    return { ok: false, reason: "cancelled" };
  }

  return { ok: true, uri: direct as string, method: "direct" };
}
