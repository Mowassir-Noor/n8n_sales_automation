"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSnapshot } from "@/components/api";
import { ComplianceBadge, StageBadge, useNow } from "@/components/badges";
import { ago, STAGES } from "@/components/derive";
import { Empty, Spinner, inputClass } from "@/components/ui";

const T = {
  title: "Leads",
  search: "Search",
  searchPh: "Company, contact, email or Lead ID",
  stage: "Stage",
  country: "Country",
  segment: "Segment",
  compliance: "Compliance",
  any: "Any",
  loading: "Loading leads…",
  empty: "No leads match.",
  count: (n: number, total: number) => (n === total ? `${total} leads` : `${n} of ${total} leads`),
  cols: { id: "Lead ID", company: "Company", stage: "Stage", country: "Country", segment: "Segment", compliance: "Compliance", updated: "Last updated" },
  ago: (t: string) => `${t} ago`,
};

function uniq(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function LeadsView() {
  const snap = useSnapshot();
  const data = snap.data;
  const now = useNow(60_000);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [country, setCountry] = useState("");
  const [segment, setSegment] = useState("");
  const [compliance, setCompliance] = useState("");

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const options = useMemo(
    () => ({
      stage: uniq([...STAGES, ...leads.map((l) => l.Stage)]),
      country: uniq(leads.map((l) => l.Country)),
      segment: uniq(leads.map((l) => l.Segment)),
      compliance: uniq(leads.map((l) => l["Compliance Status"])),
    }),
    [leads],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads
      .filter((l) => {
        if (stage && l.Stage !== stage) return false;
        if (country && l.Country.trim() !== country) return false;
        if (segment && l.Segment.trim() !== segment) return false;
        if (compliance && l["Compliance Status"].trim() !== compliance) return false;
        if (!needle) return true;
        return [l["Lead ID"], l.Company, l["Contact Name"], l.Email, l.Website].some((v) => (v || "").toLowerCase().includes(needle));
      })
      .sort((a, b) => (b["Last Updated"] || "").localeCompare(a["Last Updated"] || ""));
  }, [leads, q, stage, country, segment, compliance]);

  if (!data) return <div className="flex items-center gap-2 text-muted">{snap.isError ? null : <><Spinner /> {T.loading}</>}</div>;

  const select = (id: string, label: string, value: string, set: (v: string) => void, opts: string[]) => (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      <select id={id} className={inputClass} value={value} onChange={(e) => set(e.target.value)}>
        <option value="">{T.any}</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{T.title}</h1>
        <span className="text-sm text-muted">{T.count(filtered.length, leads.length)}</span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <label htmlFor="lead-q" className="mb-1 block text-xs font-medium text-muted">
            {T.search}
          </label>
          <input id="lead-q" type="search" className={inputClass} placeholder={T.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {select("lead-stage", T.stage, stage, setStage, options.stage)}
        {select("lead-country", T.country, country, setCountry, options.country)}
        {select("lead-segment", T.segment, segment, setSegment, options.segment)}
        {select("lead-compl", T.compliance, compliance, setCompliance, options.compliance)}
      </div>

      {filtered.length === 0 ? (
        <Empty>{T.empty}</Empty>
      ) : (
        <>
          {/* Phone: cards */}
          <ul className="space-y-2 md:hidden">
            {filtered.map((l) => (
              <li key={l["Lead ID"]}>
                <Link href={`/leads/${encodeURIComponent(l["Lead ID"])}`} className="block rounded-lg border border-line bg-surface px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{l.Company}</span>
                    <StageBadge stage={l.Stage} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{l["Lead ID"]}</span>
                    <span>{l.Country}</span>
                    <span>{l.Segment}</span>
                    {l["Compliance Status"] ? <ComplianceBadge status={l["Compliance Status"]} /> : null}
                    <span className="ml-auto">{T.ago(ago(l["Last Updated"], now))}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {/* Desktop: table */}
          <div className="relative hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  {Object.values(T.cols).map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr
                    key={l["Lead ID"]}
                    className="cursor-pointer border-t border-line hover:bg-surface-2"
                    onClick={() => router.push(`/leads/${encodeURIComponent(l["Lead ID"])}`)}
                  >
                    <td className="px-3 py-2 tabular-nums text-muted">{l["Lead ID"]}</td>
                    <td className="px-3 py-2">
                      <Link href={`/leads/${encodeURIComponent(l["Lead ID"])}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {l.Company}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StageBadge stage={l.Stage} />
                    </td>
                    <td className="px-3 py-2">{l.Country}</td>
                    <td className="px-3 py-2">{l.Segment}</td>
                    <td className="px-3 py-2">{l["Compliance Status"] ? <ComplianceBadge status={l["Compliance Status"]} /> : null}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{T.ago(ago(l["Last Updated"], now))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
