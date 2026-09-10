import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Loader2,
} from "lucide-react";
import { useCollections } from "../../context/CollectionsContext";
import { useLibraryGames } from "../../context/LibraryGamesContext";
import { loadCollectionItems } from "../../services/collectionsService";
import { resolveLocalImageSrc } from "../../services/localImageSrc";
import type { Collection } from "../../services/tauri";
import type { LibraryGame } from "../../types/libraryGame";
import AsyncImage from "../common/AsyncImage";
import { showSuccess, showError } from "../toast/GameToast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Collection Card (root level)
// ---------------------------------------------------------------------------

function CollectionCard({
  collection,
  onClick,
}: {
  collection: Collection;
  onClick: () => void;
}) {
  const { getCachedCollectionGameCount, getSubCollections } = useCollections();
  const [coverError, setCoverError] = useState(false);
  const count = getCachedCollectionGameCount(collection.id);
  const subs = getSubCollections(collection.id);
  const coverSrc = resolveLocalImageSrc(collection.coverPath);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="group cursor-pointer overflow-hidden rounded-2xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04] hover:border-(--color-accent)/30"
    >
      {/* Cover / Gradient */}
      <div className="relative aspect-[16/10] overflow-hidden">
        {coverSrc && !coverError ? (
          <AsyncImage
            src={coverSrc}
            alt={collection.name}
            className="h-full w-full object-cover"
            onError={() => setCoverError(true)}
          />
        ) : collection.color ? (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${collection.color}55, ${collection.color}22)` }}
          >
            <span className="text-2xl font-bold" style={{ color: `${collection.color}cc` }}>
              {collection.name}
            </span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/[0.04]">
            <Folder className="h-12 w-12 text-(--color-muted)/30" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100" />

        {/* Stats badge */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          {count > 0 && <span>{count} {count === 1 ? "game" : "games"}</span>}
          {subs.length > 0 && count > 0 && <span>·</span>}
          {subs.length > 0 && <span>{subs.length} {subs.length === 1 ? "sub" : "subs"}</span>}
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-center gap-2">
          {collection.color && (
            <span
              className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/10"
              style={{ backgroundColor: collection.color }}
            />
          )}
          <h3 className="text-base font-semibold text-(--color-text) truncate">{collection.name}</h3>
        </div>
        {subs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {subs.map((sub) => (
              <span
                key={sub.id}
                className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-0.5 text-[10px] text-(--color-muted)"
              >
                <Folder className="h-2.5 w-2.5" />
                {sub.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple Game Card for collection detail
// ---------------------------------------------------------------------------

function SimpleGameCard({
  game,
  onClick,
}: {
  game: LibraryGame;
  onClick: () => void;
}) {
  const imgSrc = game.coverPath || game.landscapePath || game.imageUrl;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-xl border border-(--surface-active-border) bg-white/[0.02] transition hover:bg-white/[0.04] hover:border-(--color-accent)/30"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-white/[0.04]">
        {imgSrc ? (
          <AsyncImage
            src={imgSrc}
            alt={game.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Folder className="h-8 w-8 text-(--color-muted)/30" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="p-2.5">
        <p className="text-xs font-medium text-(--color-text) truncate">{game.title}</p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Collection Detail View
// ---------------------------------------------------------------------------

function CollectionDetail({
  collection,
  onBack,
  onOpenGame,
}: {
  collection: Collection;
  onBack: () => void;
  onOpenGame: (game: LibraryGame) => void;
}) {
  const { t } = useTranslation();
  const { getSubCollections, getCachedCollectionGameCount } = useCollections();
  const { games: allGames } = useLibraryGames();
  const [gameIds, setGameIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [coverError, setCoverError] = useState(false);
  const subs = getSubCollections(collection.id);
  const coverSrc = resolveLocalImageSrc(collection.coverPath);

  // Load collection items
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCollectionItems(collection.id).then((items) => {
      if (cancelled) return;
      setGameIds(items.map((i) => i.gameId));
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [collection.id]);

  const games = useMemo(() => {
    const byId = new Map<string, LibraryGame>();
    for (const g of allGames) byId.set(g.id, g);
    return gameIds.map((id) => byId.get(id)).filter(Boolean) as LibraryGame[];
  }, [gameIds, allGames]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-muted) hover:bg-white/[0.06] hover:text-(--color-text) transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-(--color-text) truncate">{collection.name}</h1>
          </div>
        </div>

        {/* Cover banner */}
        {coverSrc && !coverError ? (
          <div className="relative h-40 w-full overflow-hidden rounded-xl mb-3">
            <AsyncImage
              src={coverSrc}
              alt={collection.name}
              className="h-full w-full object-cover"
              onError={() => setCoverError(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <h2 className="text-lg font-bold text-white drop-shadow-lg">{collection.name}</h2>
              <p className="text-sm text-white/70">
                {games.length} {games.length === 1 ? "game" : "games"}
                {subs.length > 0 && ` · ${subs.length} ${subs.length === 1 ? "category" : "categories"}`}
              </p>
            </div>
          </div>
        ) : collection.color ? (
          <div
            className="relative h-32 w-full overflow-hidden rounded-xl mb-3 flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${collection.color}55, ${collection.color}22)` }}
          >
            <span className="text-3xl font-bold" style={{ color: `${collection.color}cc` }}>
              {collection.name}
            </span>
          </div>
        ) : null}

        {/* Sub-collections chips */}
        {subs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {subs.map((sub) => {
              const subCount = getCachedCollectionGameCount(sub.id);
              return (
                <span
                  key={sub.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] border border-(--surface-active-border)/40 px-3 py-1.5 text-xs text-(--color-text)"
                >
                  {sub.color && (
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sub.color }} />
                  )}
                  {sub.name}
                  {subCount > 0 && (
                    <span className="text-[10px] text-(--color-muted)">({subCount})</span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Game grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-(--color-muted)" />
          </div>
        ) : games.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-6 py-16 text-center">
            <FolderOpen className="mb-3 h-10 w-10 text-(--color-muted)/30" />
            <p className="text-sm text-(--color-muted)">
              {t("collections.empty_collection", "This collection has no games yet.")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {games.map((game) => (
              <SimpleGameCard
                key={game.id}
                game={game}
                onClick={() => onOpenGame(game)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Collection Modal
// ---------------------------------------------------------------------------

function NewCollectionModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { collections, createCollection } = useCollections();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createCollection(name.trim(), parentId || null);
      showSuccess(t("settings.collection_created", "Collection created"));
      onClose();
    } catch (err) {
      showError(t("settings.collection_error", "Error: {{error}}", { error: String(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-2xl border border-(--surface-active-border) lf-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-(--color-text) mb-4">
          {t("settings.new_collection", "New Collection")}
        </h3>
        <div className="space-y-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            placeholder={t("settings.collection_name_placeholder", "Collection name…")}
            className="w-full rounded-lg bg-white/5 border border-(--surface-active-border)/60 px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent)"
          />
          <select
            value={parentId ?? ""}
            onChange={(e) => setParentId(e.target.value || null)}
            className="w-full rounded-lg bg-white/5 border border-(--surface-active-border)/60 px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent)"
          >
            <option value="">{t("settings.collection_parent_none", "Root Collection")}</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-(--color-muted) hover:bg-white/5 transition"
          >
            {t("settings.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-(--color-accent)/20 text-(--color-accent) hover:bg-(--color-accent)/30 transition disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("settings.save", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export type CollectionsPageProps = {
  onOpenGame: (game: LibraryGame) => void;
  initialCollectionId?: string;
};

export default function CollectionsPage({ onOpenGame, initialCollectionId }: CollectionsPageProps) {
  const { t } = useTranslation();
  const { getRootCollections, getCollectionById } = useCollections();
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [showNew, setShowNew] = useState(false);

  // Auto-select collection if initialCollectionId is provided
  useEffect(() => {
    if (initialCollectionId && !selectedCollection) {
      const col = getCollectionById(initialCollectionId);
      if (col) setSelectedCollection(col);
    }
  }, [initialCollectionId, getCollectionById]);

  const rootCollections = getRootCollections();

  // If a collection is selected, show detail view
  if (selectedCollection) {
    return (
      <CollectionDetail
        collection={selectedCollection}
        onBack={() => setSelectedCollection(null)}
        onOpenGame={onOpenGame}
      />
    );
  }

  // Root collection grid
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-(--color-text)">
            {t("sidebar.collections", "Collections")}
          </h1>
          <p className="mt-0.5 text-sm text-(--color-muted)">
            {t("collections.page_desc", "Organize and browse your game collections")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-(--color-accent)/15 text-(--color-accent) hover:bg-(--color-accent)/25 transition"
        >
          <FolderPlus className="h-4 w-4" />
          {t("settings.new_collection", "New Collection")}
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {rootCollections.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-6 py-20 text-center">
            <FolderOpen className="mb-4 h-12 w-12 text-(--color-muted)/30" />
            <p className="text-base font-medium text-(--color-text) mb-1">
              {t("collections.no_collections", "No collections yet")}
            </p>
            <p className="text-sm text-(--color-muted) mb-4">
              {t("collections.create_first", "Create your first collection to organize your games")}
            </p>
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-(--color-accent)/15 text-(--color-accent) hover:bg-(--color-accent)/25 transition"
            >
              <Plus className="h-4 w-4" />
              {t("settings.new_collection", "New Collection")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rootCollections.map((col) => (
              <CollectionCard
                key={col.id}
                collection={col}
                onClick={() => setSelectedCollection(col)}
              />
            ))}
          </div>
        )}
      </div>

      {showNew && <NewCollectionModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
