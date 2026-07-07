let _pendingStoreAppId: string | null = null;
let _pendingStoreAppTitle: string | null = null;

export function setPendingStoreDetailAppId(appId: string, title?: string) {
  _pendingStoreAppId = appId;
  _pendingStoreAppTitle = title ?? null;
}

export function consumePendingStoreDetailAppId(): string | null {
  const val = _pendingStoreAppId;
  _pendingStoreAppId = null;
  return val;
}

export function consumePendingStoreDetailAppTitle(): string | null {
  const val = _pendingStoreAppTitle;
  _pendingStoreAppTitle = null;
  return val;
}

export function peekPendingStoreDetailAppId(): string | null {
  return _pendingStoreAppId;
}
