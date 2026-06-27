import type { ReactNode } from "react";

type StoreSectionProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
};

export default function StoreSection({
  title,
  description,
  action,
  children,
}: StoreSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-(--color-text)">
            {title}
          </h2>

          {description && (
            <p className="mt-1 text-sm text-(--color-muted)">
              {description}
            </p>
          )}
        </div>

        {action && (
          <div className="shrink-0">
            {action}
          </div>
        )}
      </div>

      <div>
        {children}
      </div>
    </section>
  );
}