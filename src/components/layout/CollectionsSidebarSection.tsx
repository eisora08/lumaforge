import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Plus } from "lucide-react";
import { useCollections } from "../../context/CollectionsContext";
import { resolveLocalImageSrc } from "../../services/localImageSrc";
import AsyncImage from "../common/AsyncImage";
import type { Collection } from "../../services/tauri";
import type { SidebarSourceFilter } from "./SidebarLibraryList";

// ---------------------------------------------------------------------------
// Expandable collection row
// ---------------------------------------------------------------------------

function CollectionRow({
  collection,
  depth,
  activeCollectionId,
  onSelect,
}: {
  collection: Collection;
  depth: number;
  activeCollectionId: string | null;
  onSelect: (id: string) => void;
}) {
  const { getSubCollections, getCachedCollectionGameCount } = useCollections();
  const [expanded, setExpanded] = useState(false);
  const subs = getSubCollections(collection.id);
  const isActive = activeCollectionId === collection.id;
  const gameCount = getCachedCollectionGameCount(collection.id);
  const coverSrc = resolveLocalImageSrc(collection.coverPath);

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(collection.id)}
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition ${
          isActive
            ? "bg-(--color-accent)/10 text-(--color-accent) font-medium"
            : "text-(--color-text) hover:bg-white/[0.04]"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {subs.length > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 p-0.5 rounded hover:bg-white/10"
          >
            {expanded
              ? <ChevronDown className="h-3 w-3 text-(--color-muted)" />
              : <ChevronRight className="h-3 w-3 text-(--color-muted)" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Mini thumbnail or folder icon */}
        {coverSrc ? (
          <div className="h-5 w-5 shrink-0 overflow-hidden rounded">
            <AsyncImage src={coverSrc} alt="" className="h-full w-full object-cover" />
          </div>
        ) : collection.color ? (
          <span
            className="h-3.5 w-3.5 shrink-0 rounded ring-1 ring-white/10"
            style={{ backgroundColor: collection.color }}
          />
        ) : isActive ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
        )}

        <span className="flex-1 truncate">{collection.name}</span>
        {gameCount > 0 && (
          <span className="text-[9px] text-(--color-muted)/60 tabular-nums">{gameCount}</span>
        )}
      </button>

      {expanded && subs.map((sub) => (
        <CollectionRow
          key={sub.id}
          collection={sub}
          depth={depth + 1}
          activeCollectionId={activeCollectionId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main sidebar section
// ---------------------------------------------------------------------------

export type CollectionsSidebarSectionProps = {
  activeCollectionId: string | null;
  onCollectionSelect: (id: string | null, filter: SidebarSourceFilter) => void;
};

export default function CollectionsSidebarSection({
  activeCollectionId,
  onCollectionSelect,
}: CollectionsSidebarSectionProps) {
  const { t } = useTranslation();
  const {
    collections,
    getRootCollections,
    createCollection,
  } = useCollections();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");

  const rootCollections = getRootCollections();

  const handleSelect = (id: string) => {
    if (activeCollectionId === id) {
      onCollectionSelect(null, "all");
    } else {
      onCollectionSelect(id, "collection");
    }
  };

  const handleNewCollection = async () => {
    if (!newName.trim()) return;
    const col = await createCollection(newName.trim());
    if (col) {
      setNewName("");
      setShowNew(false);
      onCollectionSelect(col.id, "collection");
    }
  };

  if (collections.length === 0 && !showNew) {
    return (
      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-(--color-muted) hover:bg-white/[0.04] transition"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{t("sidebar.create_first_collection", "Create a Collection")}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-(--color-muted)">
          {t("sidebar.collections", "Collections")}
        </span>
        <button
          type="button"
          onClick={() => setShowNew(!showNew)}
          className="flex h-4 w-4 items-center justify-center rounded text-(--color-muted) hover:text-(--color-text) hover:bg-white/10 transition"
          title={t("sidebar.new_collection", "New Collection")}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* New collection input */}
      {showNew && (
        <div className="px-2 pb-1.5 flex gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNewCollection();
              if (e.key === "Escape") { setShowNew(false); setNewName(""); }
            }}
            placeholder={t("sidebar.collection_name", "Collection name…")}
            className="flex-1 rounded-md bg-white/5 border border-(--surface-active-border)/40 px-2 py-1 text-[11px] text-(--color-text) outline-none focus:border-(--color-accent)"
          />
          <button
            type="button"
            onClick={handleNewCollection}
            className="rounded-md bg-(--color-accent)/20 px-2 py-1 text-[11px] text-(--color-accent) hover:bg-(--color-accent)/30 transition"
          >
            {t("sidebar.add", "Add")}
          </button>
        </div>
      )}

      {/* Collection list */}
      <div className="space-y-0.5">
        {/* "All" button */}
        <button
          type="button"
          onClick={() => onCollectionSelect(null, "all")}
          className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition ${
            activeCollectionId === null
              ? "bg-(--color-accent)/10 text-(--color-accent) font-medium"
              : "text-(--color-text) hover:bg-white/[0.04]"
          }`}
        >
          <span className="w-4 shrink-0" />
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">{t("sidebar.all_collections", "All")}</span>
        </button>

        {rootCollections.map((col) => (
          <CollectionRow
            key={col.id}
            collection={col}
            depth={0}
            activeCollectionId={activeCollectionId}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}
