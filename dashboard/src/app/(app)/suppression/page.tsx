import type { Metadata } from "next";
import { SuppressionView } from "./SuppressionView";

export const metadata: Metadata = { title: "Suppression" };

export default function Page() {
  return <SuppressionView />;
}
