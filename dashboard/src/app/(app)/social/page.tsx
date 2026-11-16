import type { Metadata } from "next";
import { SocialView } from "./SocialView";

export const metadata: Metadata = { title: "LinkedIn" };

export default function Page() {
  return <SocialView />;
}
