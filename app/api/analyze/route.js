import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calaQuery, calaSearch } from "../../../lib/cala.js";
import { inspectVideo, extractFrames } from "../../../lib/video.js";
import { scoreInformation, stillPrompt } from "../../../lib/report.js";
import { kreaStill } from "../../../lib/krea.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Send a form with a Cala query." }, { status: 400 });
  }

  const query = String(form.get("query") || "").trim();
  const claims = String(form.get("claims") || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!query) {
    return Response.json({ error: "A Cala query is required." }, { status: 400 });
  }

  const errors = [];
  const queried = calaQuery(query).catch((error) => {
    errors.push(error.message || "Cala query failed");
    return { rows: [], entities: [] };
  });
  const searched = calaSearch(query).catch((error) => {
    errors.push(error.message || "Cala search failed");
    return { answer: "", sources: [] };
  });

  const videoFile = form.get("video");
  let dir = null;
  let filePath = null;
  if (videoFile && typeof videoFile.arrayBuffer === "function") {
    if ((videoFile.size || 0) > 80 * 1024 * 1024) {
      errors.push("Video is over 80MB. Use a shorter clip.");
    } else if ((videoFile.size || 0) > 0) {
      dir = await mkdtemp(join(tmpdir(), "factcut-"));
      const rawExt = String(videoFile.name || "clip.mp4").split(".").pop() || "mp4";
      const ext = rawExt.replace(/[^a-z0-9]/gi, "").slice(0, 4) || "mp4";
      filePath = join(dir, `clip.${ext}`);
      await writeFile(filePath, Buffer.from(await videoFile.arrayBuffer()));
    }
  }

  const videoTask = filePath
    ? inspectVideo(filePath).catch((error) => {
        errors.push(error.message || "Could not read the video");
        return null;
      })
    : Promise.resolve(null);

  const framesTask = filePath
    ? videoTask.then((meta) =>
        meta ? extractFrames(filePath, meta.duration || 0) : [],
      ).catch(() => [])
    : Promise.resolve([]);

  let rows = [];
  let entities = [];
  let sources = [];
  let note = "";
  let video = null;
  let frames = [];

  try {
    const [queryResult, searchResult, videoResult, frameResult] = await Promise.all([
      queried,
      searched,
      videoTask,
      framesTask,
    ]);
    rows = queryResult.rows || [];
    entities = queryResult.entities || [];
    sources = searchResult.sources || [];
    note = searchResult.answer || "";
    video = videoResult;
    frames = frameResult || [];
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const information = scoreInformation({ rows, sources, claims, note });
  const prompt = stillPrompt(rows, note);
  const still = await kreaStill(prompt).catch((error) => ({
    url: null,
    prompt,
    error: error.message || "Krea failed",
  }));

  return Response.json({
    query,
    rows,
    entities,
    sources,
    note,
    information,
    video,
    frames,
    still,
    errors,
  });
}
