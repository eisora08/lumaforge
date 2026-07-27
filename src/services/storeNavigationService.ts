let _pendingStoreAppId: string | null = null;
let _pendingStoreAppTitle: string | null = null;

type PendingListener = () => void;
const _pendingListeners = new Set<PendingListener>();

export function onPendingStoreDetail(listener: PendingListener): () => void {
  _pendingListeners.add(listener);
  return () => { _pendingListeners.delete(listener); };
}

function _notifyPendingListeners() {
  for (const fn of _pendingListeners) fn();
}

export function setPendingStoreDetailAppId(appId: string, title?: string) {
  _pendingStoreAppId = appId;
  _pendingStoreAppTitle = title ?? null;
  _notifyPendingListeners();
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
