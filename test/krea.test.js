import assert from "node:assert/strict";
import test from "node:test";
import { generateArguments, jobArguments, pickImageTool, readToolResult } from "../lib/krea.js";

test("generateArguments nests the still under input when the tool schema says so", () => {
  const args = generateArguments(
    {
      properties: {
        model: { type: "string" },
        input: { type: "object" },
      },
    },
    "A quiet cutting room",
  );
  assert.equal(args.model, "krea/krea-2/medium");
  assert.equal(args.input.prompt, "A quiet cutting room");
  assert.equal(args.input.aspect_ratio, "4:5");
  assert.equal(args.input.creativity, "low");
  assert.equal(JSON.stringify(args.input).includes("0"), false);
});

test("generateArguments stays flat when the tool schema lists the fields", () => {
  const args = generateArguments(
    {
      properties: {
        model_id: { type: "string" },
        prompt: { type: "string" },
        aspect_ratio: { type: "string" },
        sync: { type: "boolean" },
      },
    },
    "A quiet cutting room",
  );
  assert.equal(args.model_id, "krea/krea-2/medium");
  assert.equal(args.prompt, "A quiet cutting room");
  assert.equal(args.sync, false);
  assert.equal(args.input, undefined);
});

test("pickImageTool uses generate_image and ignores a missing generate tool", () => {
  const tools = [{ name: "list_models" }, { name: "generate_video" }, { name: "generate_image" }, { name: "get_job" }];
  assert.equal(pickImageTool(tools).name, "generate_image");
  assert.equal(pickImageTool([{ name: "generate" }]).name, "generate");
  assert.equal(pickImageTool([{ name: "krea_generate_image" }]).name, "krea_generate_image");
  assert.equal(pickImageTool([{ name: "generate_video" }, { name: "list_files" }]), null);
});

test("jobArguments prefers jobId", () => {
  assert.deepEqual(jobArguments({ properties: { jobId: { type: "string" } } }, "job-1"), { jobId: "job-1" });
  assert.deepEqual(jobArguments({ properties: { job_id: { type: "string" } } }, "job-1"), { job_id: "job-1" });
});

test("readToolResult takes the image URL from structured MCP output", () => {
  const read = readToolResult({
    result: {
      structuredContent: { job_id: "job-9", result: { urls: ["https://gen.krea.ai/images/still.png"] } },
      content: [{ type: "text", text: "queued" }],
    },
  });
  assert.equal(read.jobId, "job-9");
  assert.equal(read.url, "https://gen.krea.ai/images/still.png");
  assert.equal(read.errorText, "");
});
