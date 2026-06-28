export function SkeletonBox({ className }: { className?: string }) {
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
