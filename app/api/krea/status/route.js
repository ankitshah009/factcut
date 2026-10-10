import { kreaStatus } from "../../../../lib/krea-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await kreaStatus();
  return Response.json(status);
}
