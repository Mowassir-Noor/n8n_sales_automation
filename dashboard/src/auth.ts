// Auth.js v5: Google sign-in for allowlisted, verified addresses; JWT sessions carrying the role.
// Dev only: a Credentials provider with id "dev" signs in as DEV_LOGIN_EMAIL (still allowlist-checked).
import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { env } from "./lib/env";
import { normaliseEmail, roleFor } from "./lib/roles";
import type { Role } from "./lib/types";

declare module "next-auth" {
  interface Session {
    user: { role?: Role } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    /** Epoch ms of the sign-in; the session ends 7 days after it regardless of activity. */
    loginAt?: number;
  }
}

/** Provider id of the dev sign-in (only offered when DEV_LOGIN_EMAIL is set and NODE_ENV !== "production"). */
export const DEV_PROVIDER_ID = "dev";
/** Idle timeout: the cookie is re-issued with this lifetime on every request through proxy.ts. */
export const SESSION_IDLE_SECONDS = 12 * 60 * 60;
/** Absolute session lifetime. */
export const SESSION_MAX_SECONDS = 7 * 24 * 60 * 60;

function buildConfig(): NextAuthConfig {
  const e = env();
  const lists = { approverEmails: e.approverEmails, adminEmails: e.adminEmails };

  const providers: NextAuthConfig["providers"] = [];
  if (e.googleConfigured || e.isProduction) {
    providers.push(Google({ authorization: { params: { scope: "openid email profile", prompt: "select_account" } } }));
  }
  const devEmail = e.devLoginEmail; // undefined in production by construction
  if (devEmail) {
    providers.push(
      Credentials({
        id: DEV_PROVIDER_ID,
        name: "Dev sign-in",
        credentials: {},
        authorize: async () => ({ id: devEmail, email: devEmail, name: `Dev (${devEmail})` }),
      }),
    );
  }

  return {
    providers,
    trustHost: true, // behind Caddy; AUTH_URL fixes the public URL in production
    useSecureCookies: e.isProduction,
    session: { strategy: "jwt", maxAge: SESSION_IDLE_SECONDS },
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      async signIn({ account, profile, user }) {
        let email: string;
        if (account?.provider === "google") {
          if (!profile?.email_verified) return false;
          email = normaliseEmail(profile.email);
        } else if (account?.provider === DEV_PROVIDER_ID) {
          if (!devEmail) return false;
          email = normaliseEmail(user?.email);
        } else {
          return false;
        }
        const ok = roleFor(email, lists) !== null;
        console.log(JSON.stringify({ t: new Date().toISOString(), event: "signin", provider: account.provider, email, ok }));
        return ok; // false -> /signin?error=AccessDenied, no session created
      },
      async jwt({ token, user }) {
        const now = Date.now();
        if (user) {
          token.email = normaliseEmail(user.email);
          token.loginAt = now;
        }
        // Re-read the allowlists on every request: removing someone from the env ends their session.
        const role = roleFor(token.email, lists);
        if (!role) return null;
        if (!token.loginAt || now - token.loginAt > SESSION_MAX_SECONDS * 1000) return null;
        token.role = role;
        return token;
      },
      async session({ session, token }) {
        session.user.email = String(token.email ?? "");
        session.user.role = token.role;
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => buildConfig());
