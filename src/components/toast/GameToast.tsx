import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  X,
} from "lucide-react";
import toast, { Toaster, Toast } from "react-hot-toast";

const TOAST_Z_INDEX = 2147483647;

type ToastVariant = "success" | "error" | "warning" | "info";

type GameToastOptions = {
  id?: string;
  title?: string;
  duration?: number;
};

type GameToastProps = {
  t: Toast;
  variant: ToastVariant;
  title: string;
  message: string;
  duration: number;
};

const variantConfig = {
  success: {
    icon: CheckCircle2,
    title: "Operación completada",
    accent: "from-emerald-400 via-green-400 to-emerald-500",
    glow: "bg-emerald-400/25",
    iconClass: "text-emerald-300",
  },
  error: {
    icon: ShieldAlert,
    title: "Ocurrió un problema",
    accent: "from-rose-400 via-red-400 to-pink-500",
    glow: "bg-rose-400/25",
    iconClass: "text-rose-300",
  },
  warning: {
    icon: AlertTriangle,
    title: "Atención",
    accent: "from-amber-300 via-orange-400 to-yellow-500",
    glow: "bg-orange-400/25",
    iconClass: "text-amber-300",
  },
  info: {
    icon: Info,
    title: "Información",
    accent: "from-sky-300 via-cyan-400 to-blue-500",
    glow: "bg-cyan-400/25",
    iconClass: "text-cyan-300",
  },
};

function GameToast({
  t,
  variant,
  title,
  message,
  duration,
}: GameToastProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div
      className={`pointer-events-auto relative min-w-85 max-w-110 overflow-hidden rounded-3xl lf-toast-surface px-5 py-4 text-(--color-text) transition-all duration-300 ${
        t.visible
          ? "translate-y-0 scale-100 opacity-100"
          : "-translate-y-3 scale-95 opacity-0"
      }`}
    >
      <div
        className={`absolute -left-16 -top-16 h-32 w-32 rounded-full blur-3xl ${config.glow}`}
      />

      <div
        className={`absolute inset-x-0 top-0 h-0.75 bg-linear-to-r ${config.accent}`}
      />

      <div className="relative z-10 flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-(--surface-active-border) bg-(--surface-active)">
          <Icon className={`h-5 w-5 ${config.iconClass}`} />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-(--color-text)">{title}</h3>

          <p className="mt-1 text-sm leading-5 text-(--color-muted)">
            {message}
          </p>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toast.dismiss(t.id);
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-(--color-muted) transition hover:bg-(--surface-active-hover) hover:text-(--color-text)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="absolute bottom-0 left-0 h-0.75 w-full bg-(--surface-active-border)">
        <div
          className={`h-full origin-left bg-linear-to-r ${config.accent}`}
          style={{
            animation: `lf-toast-progress ${duration}ms linear forwards`,
          }}
        />
      </div>
    </div>
  );
}

function showGameToast(
  variant: ToastVariant,
  message: string,
  options: GameToastOptions = {}
) {
  const duration = options.duration ?? 2800;
  const config = variantConfig[variant];

  toast.custom(
    (t) => (
      <GameToast
        t={t}
        variant={variant}
        title={options.title ?? config.title}
        message={message}
        duration={duration}
      />
    ),
    {
      id: options.id,
      duration,
      style: {
        zIndex: TOAST_Z_INDEX,
      },
    }
  );
}

export function showSuccess(message: string, options?: GameToastOptions) {
  showGameToast("success", message, options);
}

export function showError(message: string, options?: GameToastOptions) {
  showGameToast("error", message, options);
}

export function showWarning(message: string, options?: GameToastOptions) {
  showGameToast("warning", message, options);
}

export function showInfo(message: string, options?: GameToastOptions) {
  showGameToast("info", message, options);
}

export function GameToastViewport() {
  return (
    <Toaster
      position="top-right"
      gutter={12}
      containerStyle={{
        zIndex: TOAST_Z_INDEX,
        top: 18,
        right: 18,
      }}
    />
  );
}
