"use client";

import { useEffect, useState } from "react";
import { Badge, type Tone } from "./ui";

export function ComplianceBadge({ status }: { status: string }) {
  const s = (status || "").trim();
  const tone: Tone = s === "OK" ? "ok" : s === "Needs fix" ? "warn" : s === "Blocked" ? "danger" : "neutral";
  return <Badge tone={tone}>{s || "Not checked"}</Badge>;
}

export function StageBadge({ stage }: { stage: string }) {
  const s = (stage || "").trim();
  let tone: Tone = "neutral";
  if (s === "Replied - Hot") tone = "danger";
  else if (s.startsWith("Replied")) tone = "accent";
  else if (s === "Opted out" || s === "Blocked - Compliance" || s === "Research failed") tone = "warn";
  else if (s === "Sent" || s.startsWith("Follow-up")) tone = "ok";
  return <Badge tone={tone}>{s || "No stage"}</Badge>;
}

export function CategoryBadge({ category }: { category: string }) {
  const c = (category || "").trim();
  const tone: Tone = c === "Hot" ? "danger" : c === "Warm" ? "warn" : c === "Cold" ? "accent" : "neutral";
  return <Badge tone={tone}>{c || "None"}</Badge>;
}

/** Re-renders every `ms` so "waited 3h" style labels stay current. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
