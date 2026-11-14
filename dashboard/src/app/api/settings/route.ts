import { withWrite } from "@/lib/api";
import { settingsWriteSchema } from "@/lib/schemas";
import { settingsWrite } from "@/lib/writes";

// Go-live (clearing Test Email) needs the header X-Go-Live: confirm.
export const POST = withWrite("/api/settings", settingsWriteSchema, async ({ user, req, body, log }) => {
  const data = body.data as Record<string, string>;
  log.note = "Test Email" in data && String(data["Test Email"] ?? "").trim() === "" ? "go-live" : Object.keys(data).join(",");
  return settingsWrite(user, body, req.headers.get("x-go-live") === "confirm");
});
