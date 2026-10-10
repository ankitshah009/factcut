import { kreaClip } from "../../../../lib/krea.js";
import { inspectRemoteVideo } from "../../../../lib/video.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const clip = await kreaClip(body).catch((error) => ({
    url: null,
    prompt: "",
    error: error?.message || "Krea failed",
  }));

  let picture = null;
  let gradeError = "";
  if (clip?.url) {
    try {
      picture = await inspectRemoteVideo(clip.url);
    } catch (error) {
      gradeError = error?.message || "Clip grade failed.";
    }
  }

  return Response.json({
    url: clip?.url || null,
    prompt: clip?.prompt || "",
    picture,
    error: clip?.error || "",
    code: clip?.code || "",
    gradeError,
  });
}
