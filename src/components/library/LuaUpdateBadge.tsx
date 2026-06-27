import {
  AlertCircle,
  CheckCircle2,
  PauseCircle,
  RefreshCcw,
} from "lucide-react";

import type { LuaUpdateInfo } from "../../types/luaUpdate";

type LuaUpdateBadgeProps = {
  info: LuaUpdateInfo;
};

export default function LuaUpdateBadge({ info }: LuaUpdateBadgeProps) {
  const config = getBadgeConfig(info.status);
  const Icon = config.icon;

  return (
    <span
      title={info.description}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${config.className}`}
    >
      <Icon className="h-3 w-3" />
      {info.label}
    </span>
  );
}

function getBadgeConfig(status: LuaUpdateInfo["status"]) {
  if (status === "updated") {
    return {
      icon: CheckCircle2,
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    };
  }

  if (status === "update-available") {
    return {
      icon: RefreshCcw,
      className: "border-yellow-500/20 bg-yellow-500/10 text-yellow-300",
    };
  }

  if (status === "disabled") {
    return {
      icon: PauseCircle,
      className: "border-zinc-500/20 bg-zinc-500/10 text-zinc-300",
    };
  }

  return {
    icon: AlertCircle,
    className: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  };
}