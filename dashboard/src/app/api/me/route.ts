import { json, withUser } from "@/lib/api";
import { env } from "@/lib/env";
import type { MeResponse } from "@/lib/types";

export const GET = withUser("/api/me", async ({ user }) => {
  const e = env();
  const body: MeResponse = {
    ...user,
    config: {
      weeklyFirstEmailCap: e.weeklyFirstEmailCap,
      dailyWarmupCap: e.dailyWarmupCap,
      hubspotPortalId: e.hubspotPortalId ?? null,
      sheetEnv: e.sheetEnv,
    },
  };
  return json(body);
});
