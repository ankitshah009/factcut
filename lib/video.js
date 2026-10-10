import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const SPAWN_TIMEOUT_MS = 12000;

function asNumber(value) {
  if (value == null || value === "" || value === "N/A") return 0;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseFps(value) {
  if (value == null || value === "" || value === "0/0" || value === "N/A") return 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  const text = String(value).trim();
  if (!text.includes("/")) {
    const number = Number(text);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }
  const [num, den] = text.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

function shown(value) {
  return String(Math.round(asNumber(value) * 100) / 100);
}

function isAttachedStill(stream) {
  const codec = String(stream?.codec_name || "").toLowerCase();
  if (codec !== "mjpeg" && codec !== "png") return false;
  const flag = stream?.disposition?.attached_pic;
  return flag === 1 || flag === true || flag === "1";
}

function pickVideo(streams) {
  const videos = streams.filter((stream) => stream?.codec_type === "video");
  const unattached = videos.filter((stream) => !isAttachedStill(stream));
  const pool = unattached.length > 0 ? unattached : videos;
  return (
    pool.find((stream) => {
      const codec = String(stream?.codec_name || "").toLowerCase();
      return codec !== "mjpeg" && codec !== "png";
    }) ||
    pool[0] ||
    null
  );
}

export function metaFromProbe(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = pickVideo(streams);
  const audio = streams.find((stream) => stream?.codec_type === "audio");
  let width = asNumber(video?.width);
  let height = asNumber(video?.height);
  const rotation = Math.abs(Math.round(asNumber(video?.tags?.rotate))) % 360;
  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }
  const formatDuration = probe?.format?.duration;
  const duration =
    formatDuration != null && formatDuration !== "" && formatDuration !== "N/A"
      ? asNumber(formatDuration)
      : asNumber(video?.duration);
  return {
    width,
    height,
    fps: parseFps(video?.avg_frame_rate),
    duration,
    bitrate: asNumber(probe?.format?.bit_rate),
    hasAudio: Boolean(audio),
    vcodec: video?.codec_name || null,
    acodec: audio?.codec_name || null,
  };
}

export function scoreVideo(meta) {
  const base = {
    width: asNumber(meta?.width),
    height: asNumber(meta?.height),
    fps: asNumber(meta?.fps),
    duration: asNumber(meta?.duration),
    bitrate: asNumber(meta?.bitrate),
    hasAudio: Boolean(meta?.hasAudio),
    vcodec: meta?.vcodec || null,
    acodec: meta?.acodec || null,
  };
  if (!base.vcodec) {
    return { ...base, score: 0, grade: "unusable", notes: ["No video stream."] };
  }

  let score = 35;
  const notes = [];
  if (base.height >= 1080) {
    score += 25;
    notes.push(`${shown(base.height)}p is enough for a paid social placement.`);
  } else if (base.height >= 720) {
    score += 15;
    notes.push(`${shown(base.height)}p will soften on a full-screen placement.`);
  } else if (base.height > 0) {
    score -= 10;
    notes.push(`${shown(base.height)}p is soft. Reshoot or upscale before spend.`);
  } else {
    notes.push("0p height.");
  }

  if (base.fps >= 23.9) {
    score += 10;
    notes.push(`${shown(base.fps)} fps plays cleanly.`);
  } else if (base.fps > 0) {
    score -= 5;
    notes.push(`${shown(base.fps)} fps will stutter.`);
  } else {
    notes.push("0 fps.");
  }

  if (base.hasAudio) {
    score += 10;
    notes.push("Audio track is present.");
  } else {
    score -= 8;
    notes.push("No audio track.");
  }

  if (base.duration >= 5 && base.duration <= 45) {
    score += 12;
    notes.push(`${shown(base.duration)}s sits in the social-ad window.`);
  } else if (base.duration > 45 && base.duration <= 120) {
    score += 4;
    notes.push(`${shown(base.duration)}s is long for a feed ad.`);
  } else if (base.duration > 0 && base.duration < 5) {
    score -= 6;
    notes.push(`${shown(base.duration)}s is too short to land a claim.`);
  } else if (base.duration > 120) {
    notes.push(`${shown(base.duration)}s is past two minutes.`);
  } else {
    notes.push("0s duration.");
  }

  if (base.bitrate >= 4_000_000) {
    score += 8;
    notes.push("Bitrate holds detail.");
  } else if (base.bitrate > 0 && base.bitrate < 800_000) {
    score -= 8;
    notes.push("Bitrate is crushed. Expect blockiness.");
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 75 ? "airable" : score >= 50 ? "fixable" : "weak";
  return { ...base, score, grade, notes };
}

export async function inspectVideo(filePath) {
  try {
    const { stdout } = await exec(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeout: SPAWN_TIMEOUT_MS, encoding: "utf8" },
    );
    return scoreVideo(metaFromProbe(JSON.parse(stdout)));
  } catch {
    throw new Error("ffprobe failed");
  }
}

export async function extractFrames(filePath, duration) {
  const length = asNumber(duration);
  const stamps = [0.15, 0.5, 0.85].map((ratio) => Math.max(0.2, length * ratio));
  let dir = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "factcut-frames-"));
    const frames = [];
    for (let index = 0; index < stamps.length; index += 1) {
      const out = join(dir, `${index}.jpg`);
      try {
        await exec(
          "ffmpeg",
          [
            "-nostdin",
            "-y",
            "-ss",
            stamps[index].toFixed(3),
            "-i",
            filePath,
            "-frames:v",
            "1",
            "-an",
            "-vf",
            "scale=420:-2",
            "-q:v",
            "8",
            out,
          ],
          { timeout: SPAWN_TIMEOUT_MS },
        );
        const bytes = await readFile(out);
        if (bytes.length > 0) {
          frames.push(`data:image/jpeg;base64,${bytes.toString("base64")}`);
        }
      } catch {
        // One missed frame should not fail the whole pull.
      }
    }
    return frames;
  } catch {
    return [];
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
