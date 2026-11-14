import type { Metadata } from "next";
import { ConnectView } from "./ConnectView";

export const metadata: Metadata = { title: "Connect Claude" };

export default function Page() {
  return <ConnectView />;
}
