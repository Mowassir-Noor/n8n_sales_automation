import type { Metadata } from "next";
import { LeadDetail } from "./LeadDetail";

export async function generateMetadata({ params }: PageProps<"/leads/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Lead ${decodeURIComponent(id)}` };
}

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  return <LeadDetail id={decodeURIComponent(id)} />;
}
