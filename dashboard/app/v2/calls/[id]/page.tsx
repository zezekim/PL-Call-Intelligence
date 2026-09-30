"use client";

import { CallCompact } from "@/components/v2/compact/Call";
import { CallEasy } from "@/components/v2/easy/Call";
import { useTextSize } from "@/components/v2/text-size";

export default function Page() {
  return useTextSize().size === "small" ? <CallCompact /> : <CallEasy />;
}
