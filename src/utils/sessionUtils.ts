export function formatSessionDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    if (secs === 0) return `${minutes} min`;
    return `${minutes} min ${secs} sec`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h 0m`;
  return `${hours}h ${mins}m`;
}
