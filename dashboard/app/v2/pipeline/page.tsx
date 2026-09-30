"use client";

import { PipelineCompact } from "@/components/v2/compact/Pipeline";
import { PipelineEasy } from "@/components/v2/easy/Pipeline";
import { useTextSize } from "@/components/v2/text-size";

export default function Page() {
  return useTextSize().size === "small" ? <PipelineCompact /> : <PipelineEasy />;
}
