"use client";

import { RepCompact } from "@/components/v2/compact/Rep";
import { RepEasy } from "@/components/v2/easy/Rep";
import { useTextSize } from "@/components/v2/text-size";

export default function Page() {
  return useTextSize().size === "small" ? <RepCompact /> : <RepEasy />;
}
