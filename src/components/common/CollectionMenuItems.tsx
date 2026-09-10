import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus, Check } from "lucide-react";
import { useCollections } from "../../context/CollectionsContext";
import type { Collection } from "../../services/tauri";
import type { MenuItemProps } from "../games/CardActionMenu";

/**
 * Builds a submenu item list for a collection tree.
 * Supports recursive nesting (any depth).
 */
function buildCollectionMenuItems(
  collections: Collection[],
  getSubCollections: (parentId: string) => Collection[],
  isGameInCollection: (colId: string, gameId: string) => boolean,
  toggleGameInCollection: (collectionId: string, gameId: string) => Promise<boolean>,
  gameId: string,
  onAfterAction?: () => void,
): MenuItemProps[] {
  return collections.map((col) => {
    const inCollection = isGameInCollection(col.id, gameId);
    const subs = getSubCollections(col.id);
    const handleClick = () => { toggleGameInCollection(col.id, gameId); onAfterAction?.(); };

    if (subs.length === 0) {
      return {
        label: col.name,
        icon: inCollection ? <Check className="h-3.5 w-3.5" /> : undefined,
        onClick: handleClick,
      };
    }

    return {
      label: col.name,
      icon: inCollection ? <Check className="h-3.5 w-3.5" /> : undefined,
      children: [
        {
          label: col.name,
          icon: inCollection ? <Check className="h-3.5 w-3.5" /> : undefined,
          onClick: handleClick,
        },
        ...buildCollectionMenuItems(subs, getSubCollections, isGameInCollection, toggleGameInCollection, gameId, onAfterAction),
      ],
    };
  });
}

/**
 * Hook that builds a submenu list of collections for a given game.
 * Returns MenuItemProps[] suitable for passing as `children` to a
 * CardActionMenu MenuItem.
 *
 * Must be called unconditionally at the component top level.
 * Pass `gameId` = null to get an empty list (menu not open).
 */
export function useCollectionSubmenuItems(
  gameId: string | null | undefined,
  onAfterAction?: () => void,
): MenuItemProps[] {
  const { t } = useTranslation();
  const {
    getRootCollections,
    getSubCollections,
    isGameInCollection,
    toggleGameInCollection,
    createCollection,
  } = useCollections();

  return useMemo(() => {
    if (!gameId) return [];

    const rootCollections = getRootCollections();
    const items: MenuItemProps[] = [];

    items.push({
      label: t("context_menu.new_collection"),
      icon: <FolderPlus className="h-3.5 w-3.5" />,
      onClick: () => {
        const name = prompt(t("settings.collections.editor.name_placeholder"));
        if (name?.trim()) {
          createCollection(name.trim()).then((col) => {
            if (col) toggleGameInCollection(col.id, gameId);
            onAfterAction?.();
          });
        }
      },
    });

    if (rootCollections.length > 0) {
      items.push({ label: t("context_menu.collection_separator"), disabled: true });
    }

    for (const col of rootCollections) {
      const inCollection = isGameInCollection(col.id, gameId);
      const subs = getSubCollections(col.id);

      if (subs.length === 0) {
        items.push({
          label: col.name,
          icon: inCollection ? <Check className="h-3.5 w-3.5" /> : undefined,
          onClick: () => { toggleGameInCollection(col.id, gameId); onAfterAction?.(); },
        });
      } else {
        items.push({
          label: col.name,
          icon: inCollection ? <Check className="h-3.5 w-3.5" /> : undefined,
          children: buildCollectionMenuItems(
            subs, getSubCollections, isGameInCollection, toggleGameInCollection, gameId, onAfterAction
          ),
        });
      }
    }

    return items;
  }, [gameId, getRootCollections, getSubCollections, isGameInCollection, toggleGameInCollection, createCollection, onAfterAction, t]);
}

/**
 * Inline renderer for the collection dropdown — for use inside
 * LibraryGameDetails' custom dropdown (which does not use CardActionMenu).
 */
export function CollectionDropdownItems({
  gameId,
  onAfterAction,
}: {
  gameId: string;
  onAfterAction?: () => void;
}) {
  const {
    getRootCollections,
    getSubCollections,
    isGameInCollection,
    toggleGameInCollection,
  } = useCollections();

  const rootCollections = getRootCollections();

  return (
    <>
      {rootCollections.map((col) => {
        const inCollection = isGameInCollection(col.id, gameId);
        const subs = getSubCollections(col.id);

        return (
          <div key={col.id}>
            <DropdownItem
              label={col.name}
              icon={inCollection ? <Check className="h-3.5 w-3.5" /> : undefined}
              onClick={() => { toggleGameInCollection(col.id, gameId); onAfterAction?.(); }}
            />
            {subs.map((sub) => {
              const subIn = isGameInCollection(sub.id, gameId);
              return (
                <DropdownItem
                  key={sub.id}
                  label={`  ↳ ${sub.name}`}
                  icon={subIn ? <Check className="h-3 w-3" /> : undefined}
                  onClick={() => { toggleGameInCollection(sub.id, gameId); onAfterAction?.(); }}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function DropdownItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-(--color-text) hover:bg-white/5 transition"
    >
      <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}
