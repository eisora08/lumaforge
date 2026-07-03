let _pendingStoreAppId: string | null = null;

export function setPendingStoreDetailAppId(appId: string) {
  _pendingStoreAppId = appId;
}

export function consumePendingStoreDetailAppId(): string | null {
  const val = _pendingStoreAppId;
  _pendingStoreAppId = null;
  return val;
}
