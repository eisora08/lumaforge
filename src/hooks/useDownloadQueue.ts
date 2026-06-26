
import { useDownloadQueueContext } from "../context/DownloadQueueContext";

export function useDownloadQueue() {
  return useDownloadQueueContext();
}
