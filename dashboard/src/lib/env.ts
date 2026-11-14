// Validated server environment (see the table in CONTRACT.md).
// Read lazily so `next build` works without secrets; the first request that needs a value
// gets a clear error naming the missing variable.
import { z } from "zod";

const emailList = z
  .string()
  .optional()
  .transform((s) =>
    (s ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

const intWithDefault = (def: number) =>
  z
    .string()
    .optional()
    .transform((s, ctx) => {
      if (s === undefined || s.trim() === "") return def;
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0) {
        ctx.addIssue({ code: "custom", message: "must be a whole number" });
        return z.NEVER;
      }
      return n;
    });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  AUTH_SECRET: z.string().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  AUTH_URL: z.url().optional().or(z.literal("").transform(() => undefined)),
  APPROVER_EMAILS: emailList,
  ADMIN_EMAILS: emailList,
  N8N_INTERNAL_URL: z.url().default("http://n8n:5678"),
  SHEET_ENV: z.enum(["live", "staging"]).optional(),
  DASH_KEY: z.string().optional(),
  DEV_LOGIN_EMAIL: z.string().optional(),
  WEEKLY_FIRST_EMAIL_CAP: intWithDefault(100),
  DAILY_WARMUP_CAP: intWithDefault(20),
  HUBSPOT_PORTAL_ID: z.string().optional(),
});

export type Env = {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  authUrl: string | undefined;
  approverEmails: string[];
  adminEmails: string[];
  n8nInternalUrl: string;
  sheetEnv: "live" | "staging";
  /** `${N8N_INTERNAL_URL}/webhook/${prefix}/` */
  webhookBase: string;
  dashKey: string;
  /** Lower-cased; only set when NODE_ENV !== "production". */
  devLoginEmail: string | undefined;
  weeklyFirstEmailCap: number;
  dailyWarmupCap: number;
  hubspotPortalId: string | undefined;
  googleConfigured: boolean;
};

let cached: Env | null = null;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === "production";
  const problems: string[] = [];
  if (isProduction) {
    if (!e.AUTH_SECRET) problems.push("AUTH_SECRET is required");
    if (!e.DASH_KEY) problems.push("DASH_KEY is required");
    if (!e.SHEET_ENV) problems.push("SHEET_ENV must be 'live' or 'staging'");
    if (!e.AUTH_URL) problems.push("AUTH_URL is required");
  }
  if (problems.length) throw new Error(`Invalid environment: ${problems.join("; ")}`);
  const sheetEnv = e.SHEET_ENV ?? "staging";
  const prefix = sheetEnv === "live" ? "dash" : "dash-staging";
  const base = e.N8N_INTERNAL_URL.replace(/\/+$/, "");
  const dev = !isProduction && e.DEV_LOGIN_EMAIL?.trim() ? e.DEV_LOGIN_EMAIL.trim().toLowerCase() : undefined;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    authUrl: e.AUTH_URL,
    approverEmails: e.APPROVER_EMAILS,
    adminEmails: e.ADMIN_EMAILS,
    n8nInternalUrl: base,
    sheetEnv,
    webhookBase: `${base}/webhook/${prefix}/`,
    dashKey: e.DASH_KEY ?? "",
    devLoginEmail: dev,
    weeklyFirstEmailCap: e.WEEKLY_FIRST_EMAIL_CAP,
    dailyWarmupCap: e.DAILY_WARMUP_CAP,
    hubspotPortalId: e.HUBSPOT_PORTAL_ID?.trim() || undefined,
    googleConfigured: Boolean(e.AUTH_GOOGLE_ID && e.AUTH_GOOGLE_SECRET),
  };
}

export function env(): Env {
  if (!cached) cached = readEnv();
  return cached;
}

/** For tests. */
export function resetEnvCache() {
  cached = null;
}
