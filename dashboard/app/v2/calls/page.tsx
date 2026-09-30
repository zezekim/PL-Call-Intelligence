"use client";

import { CallsCompact } from "@/components/v2/compact/Calls";
import { CallsEasy } from "@/components/v2/easy/Calls";
import { useTextSize } from "@/components/v2/text-size";

export default function Page() {
  return useTextSize().size === "small" ? <CallsCompact /> : <CallsEasy />;
}
