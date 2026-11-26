import { Suspense } from "react";
import type { Metadata } from "next";
import { QueueView } from "./QueueView";

export const metadata: Metadata = { title: "First emails" };

export default function QueuePage() {
  return (
    <Suspense fallback={null}>
      <QueueView />
    </Suspense>
  );
}
