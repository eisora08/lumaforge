import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import ConfirmModal, { type ConfirmVariant } from "../components/common/ConfirmModal";

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  icon?: React.ReactNode;
  secondaryLabel?: string;
  secondaryVariant?: ConfirmVariant;
  tertiaryLabel?: string;
  tertiaryVariant?: ConfirmVariant;
};

export type ConfirmResult = {
  confirmed: boolean;
  secondary?: boolean;
  tertiary?: boolean;
};

type ConfirmContextType = {
  confirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
};

const ConfirmContext = createContext<ConfirmContextType>({
  confirm: () => Promise.resolve({ confirmed: false }),
});

export function useConfirm() {
  return useContext(ConfirmContext);
}

type PendingConfirm = ConfirmOptions & {
  resolve: (result: ConfirmResult) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<ConfirmResult> => {
    return new Promise((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    pending?.resolve({ confirmed: true });
    setPending(null);
  }, [pending]);

  const handleCancel = useCallback(() => {
    pending?.resolve({ confirmed: false });
    setPending(null);
  }, [pending]);

  const handleSecondary = useCallback(() => {
    pending?.resolve({ confirmed: true, secondary: true });
    setPending(null);
  }, [pending]);

  const handleTertiary = useCallback(() => {
    pending?.resolve({ confirmed: true, tertiary: true });
    setPending(null);
  }, [pending]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <ConfirmModal
        open={!!pending}
        title={pending?.title ?? ""}
        description={pending?.description ?? ""}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        variant={pending?.variant}
        icon={pending?.icon}
        secondaryLabel={pending?.secondaryLabel}
        secondaryVariant={pending?.secondaryVariant}
        onSecondary={pending?.secondaryLabel ? handleSecondary : undefined}
        tertiaryLabel={pending?.tertiaryLabel}
        tertiaryVariant={pending?.tertiaryVariant}
        onTertiary={pending?.tertiaryLabel ? handleTertiary : undefined}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}
