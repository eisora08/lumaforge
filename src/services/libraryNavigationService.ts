/**
 * Module-level service for Library focus navigation.
 * Follows the same set/consume pattern as storeNavigationService.ts.
 *
 * When a package download completes in the Store, we set a pending focus appId
 * so that Library can show only that game with a "focus banner" and a clear action.
 */

let _pendingFocusAppId: string | null = null;
let _pendingFocusTitle: string | null = null;

export function setPendingLibraryFocus(appId: string, title?: string) {
  _pendingFocusAppId = appId;
  _pendingFocusTitle = title ?? null;
  console.log(`[LIBRARY_FOCUS][SET] appid=${appId} title="${title || ""}"`);
}

export function consumePendingLibraryFocus(): { appId: string; title: string | null } | null {
  const val = _pendingFocusAppId;
  const title = _pendingFocusTitle;
  _pendingFocusAppId = null;
  _pendingFocusTitle = null;
  if (val) {
    console.log(`[LIBRARY_FOCUS][CONSUME] appid=${val} title="${title || ""}"`);
    return { appId: val, title };
  }
  return null;
}

export function peekPendingLibraryFocus(): { appId: string; title: string | null } | null {
  if (_pendingFocusAppId) {
    return { appId: _pendingFocusAppId, title: _pendingFocusTitle };
  }
  return null;
}

export function clearPendingLibraryFocus() {
  if (_pendingFocusAppId) {
    console.log(`[LIBRARY_FOCUS][CLEAR] appid=${_pendingFocusAppId}`);
  }
  _pendingFocusAppId = null;
  _pendingFocusTitle = null;
}
