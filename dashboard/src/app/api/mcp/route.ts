import { bearer, mcpNotAllowed, mcpPost } from "@/lib/mcp/route";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => mcpPost(req, bearer(req));
export const GET = () => mcpNotAllowed();
export const DELETE = () => mcpNotAllowed();
