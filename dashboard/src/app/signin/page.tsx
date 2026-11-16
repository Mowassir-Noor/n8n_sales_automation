import { Suspense } from "react";
import type { Metadata } from "next";
import { SignInCard } from "./SignInCard";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Suspense fallback={null}>
        <SignInCard />
      </Suspense>
    </main>
  );
}
