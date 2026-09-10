import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  GripVertical,
  ListPlus,
  Play,
  Trash2,
  X,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePlayQueue } from "../../context/PlayQueueContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import type { AppPage } from "../../types/navigation";
import AsyncImage from "../common/AsyncImage";
import { resolveProviderMediaPreviewUrl } from "../../services/gameCacheService";
import { getCardImageCandidate } from "../../services/dashboardManualGames";

// ---------------------------------------------------------------------------
// Sortable mini card
// ---------------------------------------------------------------------------

function SortableMiniCard({
  gameId,
  title,
  imageUrl,
  isFirst,
  playLabel,
  onPlay,
  onRemove,
}: {
  gameId: string;
  title: string;
  imageUrl: string | null;
  isFirst: boolean;
  playLabel: string;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: gameId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-white/[0.04] ${
        isFirst ? "border-l-2 border-(--color-accent) bg-(--color-accent)/5" : ""
      }`}
    >
      <button
        className="flex shrink-0 cursor-grab touch-none items-center text-(--color-muted)/50 hover:text-(--color-muted) active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-white/5">
        {imageUrl ? (
          <AsyncImage
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover"
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <ListPlus className="h-3 w-3 text-(--color-muted)/40" />
              </div>
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ListPlus className="h-3 w-3 text-(--color-muted)/40" />
          </div>
        )}
      </div>
      <span className="lf-card-title min-w-0 flex-1 truncate text-xs font-medium text-(--color-text)">
        {title}
      </span>
      <button
        onClick={onPlay}
        className="shrink-0 cursor-pointer rounded p-0.5 text-(--color-muted)/50 transition hover:bg-white/10 hover:text-(--color-accent)"
        title={playLabel}
      >
        <Play className="h-3 w-3" fill="currentColor" />
      </button>
      <button
        onClick={onRemove}
        className="shrink-0 cursor-pointer rounded p-0.5 text-(--color-muted)/50 transition hover:bg-white/10 hover:text-rose-400"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PlayNextSidebarCard({ onNavigate }: { onNavigate?: (page: AppPage) => void }) {
  const { t } = useTranslation();
  const { queue, removeFromQueue, reorderQueue, clearQueue } = usePlayQueue();
  const { games: libraryGames, setSelectedGame } = useLibraryGames();
  const [expanded, setExpanded] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Resolve titles + images for queue entries
  const [resolvedItems, setResolvedItems] = useState<
    Array<{ gameId: string; title: string; imageUrl: string | null }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const items = await Promise.all(
        queue.map(async (entry) => {
          const game = libraryGames.find(
            (g) => g.id === entry.gameId || g.appId === entry.gameId,
          );
          const title = game?.title ?? entry.gameId;
          let imageUrl: string | null = null;
          if (game) {
            const rawPath = getCardImageCandidate(game);
            if (rawPath) {
              imageUrl = await resolveProviderMediaPreviewUrl(rawPath);
            }
          }
          return { gameId: entry.gameId, title, imageUrl };
        }),
      );
      if (!cancelled) setResolvedItems(items);
    };
    resolve();
    return () => { cancelled = true; };
  }, [queue, libraryGames]);

  if (queue.length === 0) return null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = queue.findIndex((e) => e.gameId === active.id);
    const newIndex = queue.findIndex((e) => e.gameId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newQueue = arrayMove(queue, oldIndex, newIndex);
    reorderQueue(newQueue.map((e) => e.gameId));
  }

  return (
    <div className="rounded-xl border border-(--surface-active-border) bg-white/[0.02]">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ListPlus className="h-4 w-4 shrink-0 text-(--color-accent)" />
        <span className="flex-1 text-xs font-bold text-(--color-text)">
          {t("sidebar.play_next", "Play Next")}
        </span>
        <span className="text-[10px] text-(--color-muted)">{queue.length}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            clearQueue();
          }}
          className="shrink-0 cursor-pointer rounded p-0.5 text-(--color-muted)/50 transition hover:bg-white/10 hover:text-rose-400"
          title={t("sidebar.play_next_clear")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-(--color-muted) transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Content */}
      {expanded && (
        <div className="max-h-[168px] overflow-y-auto lf-scroll-area border-t border-(--surface-active-border)/50 px-1.5 pb-1.5 pt-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={queue.map((e) => e.gameId)}
              strategy={verticalListSortingStrategy}
            >
              {resolvedItems.map((item, index) => (
                <SortableMiniCard
                  key={item.gameId}
                  gameId={item.gameId}
                  title={item.title}
                  imageUrl={item.imageUrl}
                  isFirst={index === 0}
                  playLabel={t("context_menu.play", "Play")}
                  onPlay={() => {
                    const game = libraryGames.find(
                      (g) => g.id === item.gameId || g.appId === item.gameId,
                    );
                    if (game) {
                      setSelectedGame(game);
                      onNavigate?.("library-game-detail");
                    }
                  }}
                  onRemove={() => removeFromQueue(item.gameId)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
