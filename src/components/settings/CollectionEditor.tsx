import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  X,
  Loader2,
  Image,
} from "lucide-react";
import { useCollections } from "../../context/CollectionsContext";
import type { Collection } from "../../services/tauri";
import { saveCollectionCover } from "../../services/tauri";
import { useConfirm } from "../../services/confirmService";
import { showSuccess, showError } from "../toast/GameToast";
import { resolveLocalImageSrc } from "../../services/localImageSrc";
import AsyncImage from "../common/AsyncImage";
import SettingsSection from "./SettingsSection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileAsBase64(file: File): Promise<{ base64: string; ext: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      const mime = result.substring(5, commaIdx);
      const base64 = commaIdx >= 0 ? result.substring(commaIdx + 1) : result;
      const ext = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpg";
      resolve({ base64, ext });
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function getAllDescendantIds(collections: Collection[], parentId: string): string[] {
  const ids: string[] = [];
  for (const c of collections) {
    if (c.parentId === parentId) {
      ids.push(c.id);
      ids.push(...getAllDescendantIds(collections, c.id));
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Single collection row
// ---------------------------------------------------------------------------

function CollectionRow({
  collection,
  depth,
  onEdit,
  onDelete,
}: {
  collection: Collection;
  depth: number;
  onEdit: (c: Collection) => void;
  onDelete: (c: Collection) => void;
}) {
  const { t } = useTranslation();
  const { getSubCollections, getCachedCollectionGameCount } = useCollections();
  const [expanded, setExpanded] = useState(false);
  const subs = getSubCollections(collection.id);
  const gameCount = getCachedCollectionGameCount(collection.id);
  const coverSrc = resolveLocalImageSrc(collection.coverPath);

  return (
    <div>
      <div
        className="flex items-center gap-1.5 rounded-lg px-2 py-2 hover:bg-white/[0.04] transition group"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {subs.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 p-0.5 rounded hover:bg-white/10"
          >
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-(--color-muted)" />
              : <ChevronRight className="h-3.5 w-3.5 text-(--color-muted)" />}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Mini cover thumbnail */}
        {coverSrc ? (
          <div className="h-6 w-6 shrink-0 overflow-hidden rounded">
            <AsyncImage src={coverSrc} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-(--color-muted)" />
        )}

        <span className="flex-1 truncate text-sm text-(--color-text)">{collection.name}</span>
        {collection.color && (
          <span
            className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/10"
            style={{ backgroundColor: collection.color }}
          />
        )}
        <span className="text-[11px] text-(--color-muted)/60 tabular-nums mr-2">
          {gameCount} {gameCount === 1 ? "game" : "games"}
        </span>
        <button
          type="button"
          onClick={() => onEdit(collection)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition"
          title={t("settings.edit", "Edit")}
        >
          <Pencil className="h-3.5 w-3.5 text-(--color-muted)" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(collection)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition"
          title={t("settings.delete", "Delete")}
        >
          <Trash2 className="h-3.5 w-3.5 text-rose-400" />
        </button>
      </div>

      {expanded && subs.map((sub) => (
        <CollectionRow
          key={sub.id}
          collection={sub}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function EditModal({
  collection,
  onClose,
}: {
  collection: Collection | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { collections, createCollection, updateCollection } = useCollections();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(collection?.name ?? "");
  const [color, setColor] = useState(collection?.color ?? "");
  const [parentId, setParentId] = useState<string | null>(collection?.parentId ?? null);
  const [coverPath, setCoverPath] = useState<string | null>(collection?.coverPath ?? null);
  const [saving, setSaving] = useState(false);

  // Filter out self and descendants to prevent cycles
  const excludedIds = collection
    ? new Set([collection.id, ...getAllDescendantIds(collections, collection.id)])
    : new Set<string>();

  const parentOptions = collections.filter((c) => !excludedIds.has(c.id));

  const handleFilePick = async (file: File) => {
    if (!collection) return; // must save first to have an ID
    try {
      const { base64, ext } = await readFileAsBase64(file);
      const absPath = await saveCollectionCover(collection.id, base64, ext);
      setCoverPath(absPath);
      await updateCollection(collection.id, { coverPath: absPath });
      showSuccess(t("settings.collection_cover_saved", "Cover image saved"));
    } catch (err) {
      showError(t("settings.collection_cover_error", "Failed to save cover: {{error}}", { error: String(err) }));
    }
  };

  const handleRemoveCover = async () => {
    if (!collection) return;
    setCoverPath(null);
    await updateCollection(collection.id, { coverPath: null });
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (collection) {
        await updateCollection(collection.id, {
          name: name.trim(),
          color: color || null,
          parentId: parentId || null,
        });
        showSuccess(t("settings.collection_updated", "Collection updated"));
      } else {
        await createCollection(name.trim(), parentId || null, color || null);
        showSuccess(t("settings.collection_created", "Collection created"));
      }
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
        className="w-full max-w-md rounded-2xl border border-(--surface-active-border) lf-surface p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-(--color-text) mb-4">
          {collection ? t("settings.edit_collection", "Edit Collection") : t("settings.new_collection", "New Collection")}
        </h3>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-(--color-text) mb-1">
              {t("settings.collection_name_label", "Name")}
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder={t("settings.collection_name_placeholder", "Collection name…")}
              className="w-full rounded-lg bg-white/5 border border-(--surface-active-border)/60 px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent)"
            />
          </div>

          {/* Parent */}
          <div>
            <label className="block text-sm font-medium text-(--color-text) mb-1">
              {t("settings.collection_parent", "Parent Collection")}
            </label>
            <select
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="w-full rounded-lg bg-white/5 border border-(--surface-active-border)/60 px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent)"
            >
              <option value="">{t("settings.collection_parent_none", "Root Collection")}</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? `\u00A0\u00A0↳ ${c.name}` : c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-(--color-text) mb-1">
              {t("settings.collection_color_label", "Color (optional)")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color || "#6366f1"}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-8 rounded border border-(--surface-active-border)/60 cursor-pointer"
              />
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#6366f1"
                className="flex-1 rounded-lg bg-white/5 border border-(--surface-active-border)/60 px-3 py-2 text-sm text-(--color-text) outline-none focus:border-(--color-accent)"
              />
              {color && (
                <button type="button" onClick={() => setColor("")} className="p-1 rounded hover:bg-white/10">
                  <X className="h-4 w-4 text-(--color-muted)" />
                </button>
              )}
            </div>
          </div>

          {/* Cover Image */}
          {collection && (
            <div>
              <label className="block text-sm font-medium text-(--color-text) mb-1">
                {t("settings.collection_cover", "Cover Image")}
              </label>
              <div className="flex items-center gap-3">
                {coverPath ? (
                  <div className="relative h-20 w-32 overflow-hidden rounded-lg border border-(--surface-active-border)/40">
                    <AsyncImage
                      src={resolveLocalImageSrc(coverPath)}
                      alt={name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleRemoveCover}
                      className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-20 w-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-(--surface-active-border)/60 text-(--color-muted) hover:border-(--color-accent)/50 hover:text-(--color-accent) transition"
                  >
                    <Image className="h-5 w-5" />
                    <span className="text-[10px]">{t("settings.collection_cover_pick", "Choose Image")}</span>
                  </button>
                )}
                {coverPath && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[11px] text-(--color-muted) hover:text-(--color-text) transition"
                  >
                    {t("settings.collection_cover_change", "Change")}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFilePick(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-(--color-muted) hover:bg-white/5 transition"
          >
            {t("settings.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-(--color-accent)/20 text-(--color-accent) hover:bg-(--color-accent)/30 transition disabled:opacity-40"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("settings.save", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export default function CollectionEditor() {
  const { t } = useTranslation();
  const {
    collections,
    getRootCollections,
    deleteCollection,
  } = useCollections();
  const { confirm } = useConfirm();
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState<Collection | null>(null);

  const rootCollections = getRootCollections();

  const handleDelete = async (col: Collection) => {
    const result = await confirm({
      title: t("settings.delete_collection", "Delete Collection"),
      description: t("settings.delete_collection_desc", "Are you sure you want to delete \"{{name}}\"? Games will not be deleted.", { name: col.name }),
      confirmLabel: t("settings.delete", "Delete"),
      variant: "danger",
    });
    if (!result.confirmed) return;
    try {
      await deleteCollection(col.id);
      showSuccess(t("settings.collection_deleted", "Collection deleted"));
    } catch (err) {
      showError(t("settings.collection_error", "Error: {{error}}", { error: String(err) }));
    }
  };

  return (
    <>
      <SettingsSection
        title={t("settings.collections", "Collections")}
        description={t("settings.collections_desc", "Organize your games into custom collections")}
      >
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-(--color-accent)/15 text-(--color-accent) hover:bg-(--color-accent)/25 transition"
          >
            <FolderPlus className="h-4 w-4" />
            {t("settings.new_collection", "New Collection")}
          </button>
        </div>

        {rootCollections.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-(--surface-active-border) bg-white/[0.02] px-6 py-12 text-center">
            <FolderOpen className="mb-3 h-8 w-8 text-(--color-muted)/30" />
            <p className="text-sm text-(--color-muted)">
              {t("settings.no_collections", "No collections yet. Create one to get started.")}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-(--surface-active-border) divide-y divide-(--surface-active-border)">
            {rootCollections.map((col) => (
              <CollectionRow
                key={col.id}
                collection={col}
                depth={0}
                onEdit={setEditTarget}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {collections.length > 0 && (
          <p className="mt-3 text-[11px] text-(--color-muted)">
            {t("settings.collections_total", "{{count}} total collections", { count: collections.length })}
          </p>
        )}
      </SettingsSection>

      {(showNew || editTarget) && (
        <EditModal
          collection={editTarget}
          onClose={() => { setShowNew(false); setEditTarget(null); }}
        />
      )}
    </>
  );
}
