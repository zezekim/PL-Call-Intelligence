"use client";

import { OverviewCompact } from "@/components/v2/compact/Overview";
import { OverviewEasy } from "@/components/v2/easy/Overview";
import { useTextSize } from "@/components/v2/text-size";

export default function Page() {
  return useTextSize().size === "small" ? <OverviewCompact /> : <OverviewEasy />;
}
