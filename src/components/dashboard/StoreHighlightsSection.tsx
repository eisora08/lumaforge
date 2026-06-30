import { Gamepad2, Sparkles, Store } from "lucide-react";
import type { AppPage } from "../../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function StoreHighlightsSection({ onNavigate }: Props) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-(--surface-active-border) bg-gradient-to-br from-(--color-accent)/8 via-purple-900/15 to-black">
      <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-(--color-accent)/10 blur-3xl" />
      <div className="absolute bottom-0 left-1/4 h-32 w-32 rounded-full bg-purple-500/8 blur-3xl" />

      <div className="relative z-10 flex flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row sm:px-8">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-(--color-accent)/10">
            <Store className="h-6 w-6 text-(--color-accent)" />
          </div>
          <div>
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-(--color-accent)/20 bg-(--color-accent)/10 px-2.5 py-0.5 text-[10px] text-(--color-accent)">
              <Sparkles className="h-3 w-3" />
              Store
            </div>
            <h3 className="text-base font-bold text-(--color-text)">
              Discover New Games
            </h3>
            <p className="mt-0.5 text-sm text-(--color-muted)">
              Browse featured titles, top sellers, and Lua-ready games.
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigate?.("store")}
          className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-(--color-accent) px-5 py-3 text-sm font-medium text-black transition hover:opacity-90"
        >
          <Gamepad2 className="h-4 w-4" />
          Browse Store
        </button>
      </div>
    </section>
  );
}
