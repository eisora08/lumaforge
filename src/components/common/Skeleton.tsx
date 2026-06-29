export function SkeletonBox({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-white/5 ${className ?? ""}`} />
  );
}

export function SkeletonText({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-white/5 ${className ?? ""}`} />
  );
}

export function SidebarThumbSkeleton() {
  return (
    <div className="h-6 w-10 shrink-0 animate-pulse rounded bg-white/5" />
  );
}

export function PosterCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-(--surface-active-border) bg-white/[0.03]">
      <div className="aspect-[3/4] animate-pulse rounded-t-2xl bg-white/5" />
      <div className="space-y-2 px-3 py-2.5">
        <SkeletonBox className="h-3 w-3/4" />
        <SkeletonBox className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function LandscapeCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-(--surface-active-border) bg-white/[0.03]">
      <div className="aspect-video animate-pulse rounded-t-2xl bg-white/5" />
      <div className="space-y-2 px-3 py-2.5">
        <SkeletonBox className="h-3 w-3/4" />
        <SkeletonBox className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function LibrarySectionSkeleton() {
  return (
    <div className="space-y-3">
      <SkeletonBox className="h-4 w-48" />
      <SkeletonBox className="h-3 w-32" />
    </div>
  );
}

export function GridSkeleton({ poster, count }: { poster?: boolean; count?: number }) {
  const items = Array.from({ length: count ?? 8 });
  const Card = poster ? PosterCardSkeleton : LandscapeCardSkeleton;
  return (
    <div
      className={
        poster
          ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
          : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      }
    >
      {items.map((_, i) => <Card key={i} />)}
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div className="relative w-full animate-pulse overflow-hidden rounded-2xl bg-white/[0.03]">
      <div className="aspect-[21/9] bg-white/5" />
      <div className="absolute bottom-0 left-0 right-0 space-y-3 p-6">
        <div className="h-5 w-64 rounded bg-white/10" />
        <div className="h-3 w-40 rounded bg-white/5" />
      </div>
    </div>
  );
}

export function SkeletonListRow({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3"
        >
          <div className="h-10 w-16 shrink-0 animate-pulse rounded-lg bg-white/5" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-3/5 animate-pulse rounded bg-white/5" />
            <div className="h-2.5 w-2/5 animate-pulse rounded bg-white/[0.03]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonSidebarItem() {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <div className="h-6 w-10 shrink-0 animate-pulse rounded bg-white/5" />
      <div className="h-3 flex-1 animate-pulse rounded bg-white/5" />
    </div>
  );
}

export function SkeletonGameCard() {
  return (
    <div className="flex flex-col rounded-2xl border border-(--surface-active-border) bg-white/[0.03]">
      <div className="aspect-video animate-pulse rounded-t-2xl bg-white/5" />
      <div className="space-y-2.5 p-3">
        <SkeletonBox className="h-3.5 w-4/5" />
        <SkeletonBox className="h-3 w-1/3" />
        <div className="flex gap-2 pt-1">
          <SkeletonBox className="h-7 flex-1 rounded-lg" />
          <SkeletonBox className="h-7 w-7 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonUpdateCard() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-4">
      <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-white/5" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/5" />
        <div className="h-3 w-full animate-pulse rounded bg-white/[0.03]" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.03]" />
      </div>
      <div className="h-3 w-16 shrink-0 animate-pulse rounded bg-white/5" />
    </div>
  );
}

export function SkeletonAchievementRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-(--surface-active-border) bg-white/[0.02] p-3">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-white/5" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-3/5 animate-pulse rounded bg-white/5" />
        <div className="h-2.5 w-full animate-pulse rounded bg-white/[0.03]" />
      </div>
      <div className="h-5 w-12 shrink-0 animate-pulse rounded-full bg-white/5" />
    </div>
  );
}
