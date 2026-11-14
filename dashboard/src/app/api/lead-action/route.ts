import { withWrite } from "@/lib/api";
import { leadActionSchema } from "@/lib/schemas";
import { leadActionWrite } from "@/lib/writes";

export const POST = withWrite("/api/lead-action", leadActionSchema, async ({ user, body, log }) => {
  log.action = body.action;
  log.leadId = body.leadId;
  return leadActionWrite(user, body);
});
