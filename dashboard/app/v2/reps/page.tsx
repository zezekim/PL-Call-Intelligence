"use client";

import { RepsCompact } from "@/components/v2/compact/Reps";
import { RepsEasy } from "@/components/v2/easy/Reps";
import { useTextSize } from "@/components/v2/text-size";

export default function Page() {
  return useTextSize().size === "small" ? <RepsCompact /> : <RepsEasy />;
}
