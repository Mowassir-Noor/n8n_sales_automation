import { mcpNotAllowed, mcpPost } from "@/lib/mcp/route";

export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  return mcpPost(req, key);
}
export const GET = () => mcpNotAllowed();
export const DELETE = () => mcpNotAllowed();
