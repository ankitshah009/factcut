import { startKreaConnect } from "../../../../lib/krea-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const redirectUri = new URL("/api/krea/callback", request.url).toString();
  try {
    const url = await startKreaConnect(redirectUri);
    return Response.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Krea sign-in did not start.";
    return new Response(message, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
