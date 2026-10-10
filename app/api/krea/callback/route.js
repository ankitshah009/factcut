import { finishKreaConnect } from "../../../../lib/krea-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const back = new URL("/", url.origin);
  if (url.searchParams.get("error") || !url.searchParams.get("code") || !url.searchParams.get("state")) {
    back.searchParams.set("krea", "denied");
    return Response.redirect(back);
  }
  try {
    await finishKreaConnect({
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      redirectUri: new URL("/api/krea/callback", url.origin).toString(),
    });
  } catch {
    back.searchParams.set("krea", "denied");
    return Response.redirect(back);
  }
  return Response.redirect(back);
}
