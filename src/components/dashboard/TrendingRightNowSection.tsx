import { useEffect, useRef } from "react";
import type { AppPage } from "../../types/navigation";

type Props = {
  onNavigate?: (page: AppPage) => void;
};

export default function TrendingRightNowSection(_props: Props) {
  const loggedRef = useRef(false);

  useEffect(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    console.log("[DASH][TRENDING] available=false reason=no-trending-signal");
    console.log("[DASH][SECTION_SKIP] section=TrendingRightNow reason=no-trending-signal");
  }, []);

  return null;
}
