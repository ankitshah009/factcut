import assert from "node:assert/strict";
import test from "node:test";
import { clipPrompt, snapClip, videoArguments, LTX_INPUT_SCHEMA } from "../lib/clip.js";
import { pickVideoTool, readToolResult } from "../lib/krea.js";
import { kreaFileUrl } from "../lib/video.js";

const TOOL_SCHEMA = {
  properties: {
    model: { type: "string" },
    input: { type: "object" },
    sync: { type: "boolean" },
  },
};

test("clipPrompt rewrites photo, drops digits, and names the camera move", () => {
  const prompt = clipPrompt(
    "Documentary photo of a quiet room, 1080p, take 4, no text, no numbers, no logos, no charts.",
    "dolly_in",
  );
  assert.match(prompt, /Documentary shot of a quiet room/i);
  assert.match(prompt, /The camera dollies in/);
  assert.match(prompt, /No text, no numbers, no logos, no charts\.$/);
  assert.equal(prompt.match(/No text/gi).length, 1);
  assert.equal(/\d/.test(prompt), false);
  assert.equal(/1080|720/.test(prompt), false);
});

test("clipPrompt falls back when the subject is too thin", () => {
  const prompt = clipPrompt("4k", "jib_up");
  assert.match(prompt, /^Documentary shot, natural light\. The camera rises on a jib\./);
  assert.equal(/\d/.test(prompt), false);
});

test("snapClip allowlists motion, length, frame, and the start still", () => {
  const snap = snapClip({
    subject: "A desk",
    motion: "zoom",
    duration: "9",
    aspect: "1:1",
    audio: "false",
    startImage: "http://gen.krea.ai/images/still.png",
  });
  assert.equal(snap.motion, "dolly_in");
  assert.equal(snap.duration, 6);
  assert.equal(snap.aspect, "16:9");
  assert.equal(snap.audio, false);
  assert.equal(snap.startImage, "");

  const kept = snapClip({
    motion: "static",
    duration: 8,
    aspect: "9:16",
    audio: true,
    startImage: "https://gen.krea.ai/images/still.png",
  });
  assert.equal(kept.motion, "static");
  assert.equal(kept.duration, 8);
  assert.equal(kept.aspect, "9:16");
  assert.equal(kept.audio, true);
  assert.equal(kept.startImage, "https://gen.krea.ai/images/still.png");
});

test("videoArguments keeps length and resolution out of the prompt", () => {
  const args = videoArguments(TOOL_SCHEMA, LTX_INPUT_SCHEMA, {
    subject: "Scene 12 with 1080p detail",
    motion: "dolly_in",
    duration: 6,
    aspect: "16:9",
    audio: true,
    startImage: "https://gen.krea.ai/images/still.png",
  });
  assert.equal(args.model, "lightricks/ltx-video-2.5-fast");
  assert.equal(args.sync, false);
  assert.equal(args.input.duration, 6);
  assert.equal(args.input.resolution, "1080p");
  assert.equal(args.input.aspect_ratio, "16:9");
  assert.equal(args.input.camera_motion, "dolly_in");
  assert.equal(args.input.generate_audio, true);
  assert.equal(args.input.start_image, "https://gen.krea.ai/images/still.png");
  assert.equal(/\d/.test(args.input.prompt), false);
  assert.equal(args.input.prompt.includes("1080"), false);
  assert.equal(args.input.prompt.includes("6"), false);
});

test("videoArguments snaps to the schema and prefers a tall frame", () => {
  const schema = {
    properties: {
      prompt: {},
      duration: { anyOf: [{ const: 8 }, { const: 10 }] },
      resolution: { enum: ["720p", "480p"] },
      aspect_ratio: { enum: ["9:16"] },
      camera_motion: { enum: ["static"] },
    },
  };
  const args = videoArguments(TOOL_SCHEMA, schema, {
    subject: "A quiet cutting room",
    motion: "dolly_in",
    duration: 6,
    aspect: "16:9",
    audio: true,
  });
  assert.equal(args.input.duration, 8);
  assert.equal(args.input.resolution, "720p");
  assert.equal(args.input.aspect_ratio, "9:16");
  assert.equal(args.input.camera_motion, "static");
  assert.equal(args.input.start_image, undefined);
});

test("pickVideoTool uses generate_video", () => {
  const tools = [{ name: "generate_image" }, { name: "generate_video" }, { name: "get_job" }];
  assert.equal(pickVideoTool(tools).name, "generate_video");
  assert.equal(pickVideoTool([{ name: "krea_generate_video" }]).name, "krea_generate_video");
  assert.equal(pickVideoTool([{ name: "generate" }, { name: "generate_image" }]), null);
});

test("readToolResult prefers a video file over a poster", () => {
  const message = {
    result: {
      structuredContent: {
        job_id: "job-3",
        result: {
          urls: ["https://gen.krea.ai/images/poster.jpg", "https://gen.krea.ai/videos/clip.mp4"],
        },
      },
      content: [{ type: "text", text: "ready" }],
    },
  };
  const video = readToolResult(message, { prefer: "video" });
  assert.equal(video.jobId, "job-3");
  assert.equal(video.url, "https://gen.krea.ai/videos/clip.mp4");
  const image = readToolResult(message);
  assert.equal(image.url, "https://gen.krea.ai/images/poster.jpg");
});

test("kreaFileUrl accepts only https Krea hosts", () => {
  assert.equal(kreaFileUrl("https://gen.krea.ai/videos/clip.mp4"), "https://gen.krea.ai/videos/clip.mp4");
  assert.equal(kreaFileUrl("https://krea.ai/file"), "https://krea.ai/file");
  assert.equal(kreaFileUrl("http://gen.krea.ai/videos/clip.mp4"), "");
  assert.equal(kreaFileUrl("https://notkrea.ai/clip.mp4"), "");
  assert.equal(kreaFileUrl("https://evil.com/krea.ai/clip.mp4"), "");
});
