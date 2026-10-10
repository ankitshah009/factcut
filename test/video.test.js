import assert from "node:assert/strict";
import test from "node:test";
import { extractFrames, inspectVideo, metaFromProbe, scoreVideo } from "../lib/video.js";

test("metaFromProbe swaps portrait rotation and parses fps", () => {
  const meta = metaFromProbe({
    format: { duration: "12.5", bit_rate: "5000000" },
    streams: [
      {
        codec_type: "video",
        codec_name: "mjpeg",
        width: 300,
        height: 300,
        avg_frame_rate: "1/1",
        disposition: { attached_pic: 1 },
      },
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30000/1001",
        tags: { rotate: "90" },
      },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
  assert.equal(meta.vcodec, "h264");
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
  assert.ok(Math.abs(meta.fps - 29.97) < 0.02);
  assert.equal(meta.hasAudio, true);
  assert.equal(meta.duration, 12.5);
  assert.equal(meta.bitrate, 5_000_000);
  assert.equal(meta.acodec, "aac");

  const turned = metaFromProbe({
    format: { duration: "9", bit_rate: "1000000" },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1280,
        height: 720,
        avg_frame_rate: "24000/1001",
        tags: { rotate: "270" },
      },
    ],
  });
  assert.equal(turned.width, 720);
  assert.equal(turned.height, 1280);
  assert.ok(Math.abs(turned.fps - 23.976) < 0.01);
  assert.equal(turned.hasAudio, false);

  const flat = metaFromProbe({
    format: {},
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 640,
        height: 360,
        avg_frame_rate: "30/1",
        duration: "7.25",
        tags: { rotate: "180" },
      },
    ],
  });
  assert.equal(flat.width, 640);
  assert.equal(flat.height, 360);
  assert.equal(flat.duration, 7.25);
  assert.equal(flat.bitrate, 0);
});

test("a 1080p clip with audio in the social window is airable", () => {
  const scored = scoreVideo({
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 15,
    bitrate: 5_000_000,
    hasAudio: true,
    vcodec: "h264",
    acodec: "aac",
  });
  assert.equal(scored.grade, "airable");
  assert.ok(scored.score >= 75 && scored.score <= 100);
  assert.equal(scored.height, 1080);
  assert.equal(scored.vcodec, "h264");
  const notes = scored.notes.join(" ");
  assert.match(notes, /1080p/);
  assert.match(notes, /30 fps/);
  assert.match(notes, /15s/);
});

test("a tiny silent clip scores weak and a missing codec scores zero", () => {
  const weak = scoreVideo({
    width: 320,
    height: 240,
    fps: 12,
    duration: 2,
    bitrate: 200_000,
    hasAudio: false,
    vcodec: "h264",
    acodec: null,
  });
  assert.equal(weak.grade, "weak");
  assert.ok(weak.score < 50);
  const notes = weak.notes.join(" ");
  assert.match(notes, /240p/);
  assert.match(notes, /12 fps/);
  assert.match(notes, /2s/);

  const empty = scoreVideo({ vcodec: null });
  assert.equal(empty.score, 0);
  assert.equal(empty.grade, "unusable");
  assert.deepEqual(empty.notes, ["No video stream."]);
});

test("inspectVideo failures do not include environment values", async () => {
  const home = process.env.HOME || "";
  await assert.rejects(() => inspectVideo(`${home}/no-such-factcut-clip.mp4`), (error) => {
    assert.ok(error instanceof Error);
    for (const value of Object.values(process.env)) {
      if (typeof value === "string" && value.length >= 8) {
        assert.equal(error.message.includes(value), false);
      }
    }
    return true;
  });
});

test("extractFrames returns an empty list when the file cannot be read", async () => {
  const frames = await extractFrames(`${process.env.HOME || ""}/no-such-factcut-clip.mp4`, 10);
  assert.deepEqual(frames, []);
});
