import { withWrite } from "@/lib/api";
import { socialWriteSchema } from "@/lib/schemas";
import { socialWrite } from "@/lib/writes";

export const POST = withWrite("/api/social", socialWriteSchema, async ({ user, body, log }) => {
  log.note = `row ${body.rowNumber}`;
  return socialWrite(user, body);
});
