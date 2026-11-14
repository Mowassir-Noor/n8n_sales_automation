import { withWrite } from "@/lib/api";
import { suppressionWriteSchema } from "@/lib/schemas";
import { suppressionWrite } from "@/lib/writes";

export const POST = withWrite("/api/suppression", suppressionWriteSchema, async ({ user, body, log }) => {
  log.action = body.action;
  return suppressionWrite(user, body);
});
