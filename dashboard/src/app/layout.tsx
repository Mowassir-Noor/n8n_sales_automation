import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "Texprove approvals", template: "%s · Texprove approvals" },
  description: "Approve, edit or reject outgoing Texprove emails.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#171b1f" },
  ],
};

// Every page renders per request so the proxy's CSP nonce reaches Next.js's own scripts (see dev/README.md).
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-bg text-fg text-sm">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
