import { CheckCircle2, Gamepad2, Server } from "lucide-react";
import { useState, useMemo } from "react";

type StoreGameMediaGalleryProps = {
  title: string;
  imageUrl?: string;
  galleryImages?: string[];
  installStatus?: string;
  availableSourcesCount: number;
  appId: string;
  developer: string;
  platforms: string[];
};

export default function StoreGameMediaGallery({
  title,
  imageUrl,
  galleryImages = [],
  installStatus = "not-installed",
  availableSourcesCount,
  appId,
  developer,
  platforms,
}: StoreGameMediaGalleryProps) {
  const allImages = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];

    if (imageUrl && !seen.has(imageUrl)) {
      seen.add(imageUrl);
      result.push(imageUrl);
    }

    for (const img of galleryImages) {
      if (img && !seen.has(img)) {
        seen.add(img);
        result.push(img);
      }
    }

    return result;
  }, [galleryImages, imageUrl]);

  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);

  const validImages = useMemo(
    () => allImages.filter((img) => !failedImages.has(img)),
    [allImages, failedImages]
  );

  const safeIndex = Math.min(
    selectedIndex,
    Math.max(0, validImages.length - 1)
  );

  const currentImage = validImages.length > 0 ? validImages[safeIndex] : null;

  function handleImageError(src: string) {
    setFailedImages((prev) => {
      const next = new Set(prev);
      next.add(src);
      return next;
    });
  }

  return (
    <div>
      <div className="relative h-[360px] overflow-hidden bg-white/5">
        {currentImage ? (
          <img
            src={currentImage}
            alt={title}
            className="h-full w-full object-cover"
            onError={() => {
              handleImageError(currentImage);
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 className="h-16 w-16 text-(--color-muted)" />
          </div>
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black via-black/45 to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
          <div className="mb-3 flex flex-wrap gap-2">
            {installStatus === "active" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Installed
              </span>
            )}

            {availableSourcesCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-3 py-1 text-xs text-(--color-accent)">
                <Server className="h-3.5 w-3.5" />
                Lua Ready
              </span>
            )}

            <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/70">
              AppID {appId}
            </span>
          </div>

          <h1 className="max-w-4xl text-4xl font-black text-white">
            {title}
          </h1>

          <p className="mt-2 text-sm text-white/70">
            {developer}
          </p>

          {platforms.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {platforms.map((platform) => (
                <span
                  key={platform}
                  className="rounded-md border border-white/10 bg-white/10 px-2.5 py-1 text-xs text-white/75"
                >
                  {platform}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {validImages.length > 1 && (
        <div className="flex gap-2 border-t border-(--surface-active-border) bg-black/40 px-4 py-3">
          {validImages.map((img, idx) => (
            <button
              key={img}
              type="button"
              onClick={() => {
                setSelectedIndex(idx);
              }}
              className={`relative flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-200 ${
                idx === safeIndex
                  ? "border-(--color-accent) ring-1 ring-(--color-accent)/50"
                  : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <img
                src={img}
                alt=""
                className="h-16 w-28 object-cover"
                onError={() => {
                  handleImageError(img);
                }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
