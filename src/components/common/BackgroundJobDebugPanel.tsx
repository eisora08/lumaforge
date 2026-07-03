import { useEffect, useState } from "react";
import { backgroundJobQueue, type BackgroundJob } from "../../services/backgroundJobQueue";

export default function BackgroundJobDebugPanel() {
  const [queue, setQueue] = useState<BackgroundJob[]>([]);
  const [active, setActive] = useState<BackgroundJob[]>([]);
  const [recent, setRecent] = useState<{ key: string; time: number }[]>([]);
  const [failed, setFailed] = useState<{ key: string; time: number; error: string }[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsub = backgroundJobQueue.subscribe(() => {
      setQueue(backgroundJobQueue.getQueue());
      setActive(backgroundJobQueue.getActiveJobs());
      setRecent(backgroundJobQueue.getRecentlyCompleted());
      setFailed(backgroundJobQueue.getRecentlyFailed());
    });
    // Initial state
    setQueue(backgroundJobQueue.getQueue());
    setActive(backgroundJobQueue.getActiveJobs());
    setRecent(backgroundJobQueue.getRecentlyCompleted());
    setFailed(backgroundJobQueue.getRecentlyFailed());
    return unsub;
  }, []);

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-blue-600 px-3 py-1 text-xs text-white shadow-lg opacity-60 hover:opacity-100"
        title="Show background jobs"
      >
        Jobs
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-h-96 overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-bg-primary) p-3 shadow-xl text-xs font-mono">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-(--color-text)">Background Jobs</span>
        <button onClick={() => setVisible(false)} className="text-(--color-muted) hover:text-(--color-text)">✕</button>
      </div>

      <div className="mb-2 flex gap-2 text-(--color-muted)">
        <span>📋 {queue.length} queued</span>
        <span>⚡ {active.length} running</span>
        <span>✅ {recent.length} recent</span>
        <span>❌ {failed.length} failed</span>
      </div>

      {active.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-(--color-accent)">Running:</div>
          {active.map((job) => (
            <div key={job.id} className="flex items-center gap-1 text-green-400">
              <span className="animate-pulse">▶</span>
              <span>{job.id}</span>
            </div>
          ))}
        </div>
      )}

      {queue.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-(--color-muted)">Queued:</div>
          {queue.slice(0, 10).map((job) => (
            <div key={job.id} className="flex items-center gap-1 text-(--color-text)">
              <span className="text-(--color-muted)">⏳</span>
              <span className="flex-1 truncate">{job.id}</span>
              <span className="text-(--color-muted)">{job.priority}</span>
            </div>
          ))}
          {queue.length > 10 && <div className="text-(--color-muted)">... and {queue.length - 10} more</div>}
        </div>
      )}

      {failed.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-red-400">Failed:</div>
          {failed.map((f) => (
            <div key={f.key} className="text-red-400 truncate" title={f.error}>
              ❌ {f.key}: {f.error.slice(0, 80)}
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="mb-1 text-(--color-muted)">Recent completions:</div>
          {recent.map((r) => (
            <div key={r.key} className="text-green-500/70">
              ✅ {r.key}
            </div>
          ))}
        </div>
      )}

      {queue.length === 0 && active.length === 0 && failed.length === 0 && (
        <div className="text-(--color-muted)">No background jobs queued.</div>
      )}
    </div>
  );
}
