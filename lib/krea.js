import { LTX_INPUT_SCHEMA, VIDEO_MODEL, clipPrompt, snapClip, videoArguments } from "./clip.js";
import { kreaAccessToken, KreaAuthError } from "./krea-auth.js";

const MCP = "https://api.krea.ai/mcp";
const MODEL = "krea/krea-2/medium";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let rpcId = 1;

function nextId() {
  rpcId += 1;
  return rpcId;
}

function firstUrl(value) {
  if (!value) return null;
  if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    return (
      firstUrl(value.url) ||
      firstUrl(value.image_url) ||
      firstUrl(value.image) ||
      firstUrl(value.src) ||
      null
    );
  }
  return null;
}

function urlsFrom(job) {
  return (
    firstUrl(job?.result?.urls) ||
    firstUrl(job?.result?.images) ||
    firstUrl(job?.result?.image_url) ||
    firstUrl(job?.result?.image) ||
    firstUrl(job?.result?.url) ||
    firstUrl(job?.data?.urls) ||
    firstUrl(job?.output?.urls) ||
    firstUrl(job?.urls) ||
    firstUrl(job?.image_url) ||
    firstUrl(job?.url) ||
    firstUrl(job?.job) ||
    null
  );
}

function urlsInText(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s"'<>]+/g) || [];
  const cleaned = matches.map((url) => url.replace(/[),.;]+$/, ""));
  return (
    cleaned.find((url) => /gen\.krea\.ai/i.test(url) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) ||
    null
  );
}

function isVideoUrl(url) {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || /\/videos?\//i.test(url);
}

function gatherUrls(value, found, depth = 0) {
  if (!value || depth > 6) return;
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value)) found.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) gatherUrls(item, found, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) gatherUrls(item, found, depth + 1);
  }
}

const STILL_FIELDS = {
  aspect_ratio: "4:5",
  resolution: "1K",
  creativity: "low",
};

export function generateArguments(schema, prompt) {
  const input = { prompt, ...STILL_FIELDS };
  const props = schema?.properties && typeof schema.properties === "object" ? schema.properties : null;
  const modelKey = ["model", "model_id", "modelId", "endpoint"].find((key) => props?.[key]);
  if (!props || props.input) {
    const args = { input };
    args[modelKey || "model"] = MODEL;
    if (props?.sync) args.sync = false;
    if (props?.wait) args.wait = false;
    return args;
  }
  const args = {};
  if (modelKey) args[modelKey] = MODEL;
  for (const [key, value] of Object.entries(input)) {
    if (props[key]) args[key] = value;
  }
  if (!args.prompt) args.prompt = prompt;
  if (props.sync) args.sync = false;
  if (props.wait) args.wait = false;
  return args;
}

export function pickImageTool(tools) {
  const list = Array.isArray(tools) ? tools : [];
  const named = (name) => list.find((tool) => tool?.name === name);
  return (
    named("generate_image") ||
    named("generate") ||
    list.find((tool) => /generate/i.test(tool?.name || "") && /image/i.test(tool?.name || "")) ||
    null
  );
}

export function pickVideoTool(tools) {
  const list = Array.isArray(tools) ? tools : [];
  const named = (name) => list.find((tool) => tool?.name === name);
  return (
    named("generate_video") ||
    list.find((tool) => /generate/i.test(tool?.name || "") && /video/i.test(tool?.name || "")) ||
    null
  );
}

export function pickJobTool(tools) {
  const list = Array.isArray(tools) ? tools : [];
  return list.find((tool) => tool?.name === "get_job") || null;
}

export function jobArguments(schema, jobId) {
  const props = schema?.properties && typeof schema.properties === "object" ? schema.properties : null;
  if (props?.job_id) return { job_id: jobId };
  if (props?.id && !props?.jobId) return { id: jobId };
  return { jobId };
}

export function readToolResult(message, options = {}) {
  const preferVideo = options?.prefer === "video";
  const result = message?.result && typeof message.result === "object" ? message.result : {};
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? result.structuredContent
      : null;
  const texts = Array.isArray(result.content)
    ? result.content.filter((item) => item && item.type === "text" && item.text).map((item) => String(item.text))
    : [];
  let parsed = null;
  for (const text of texts) {
    try {
      const value = JSON.parse(text);
      if (value && typeof value === "object") {
        parsed = value;
        break;
      }
    } catch {
      /* The tool sometimes returns a sentence plus a URL. */
    }
  }
  const body = structured || parsed || {};
  const nested = body.job && typeof body.job === "object" ? body.job : body;
  let url = null;
  if (preferVideo) {
    const gathered = [];
    gatherUrls(nested, gathered);
    gatherUrls(parsed, gathered);
    gatherUrls(structured, gathered);
    for (const text of texts) {
      const matches = String(text).match(/https?:\/\/[^\s"'<>]+/g) || [];
      for (const item of matches) gathered.push(item.replace(/[),.;]+$/, ""));
    }
    url = gathered.find(isVideoUrl) || gathered.find((item) => /gen\.krea\.ai/i.test(item)) || null;
  } else {
    url =
      urlsFrom(nested) ||
      urlsFrom(parsed) ||
      urlsFrom(structured) ||
      texts.map(urlsInText).find(Boolean) ||
      null;
  }
  const jobId = nested.job_id || nested.jobId || body.job_id || body.jobId || parsed?.job_id || parsed?.jobId || null;
  const status = String(nested.status || body.status || parsed?.status || "").toLowerCase();
  const errorText = result.isError ? texts.join(" ").trim() || "Krea generation failed." : "";
  return { url, jobId, status, errorText };
}

function scrub(message, secret) {
  const text = String(message || "Krea failed");
  return (secret && secret.length > 8 ? text.split(secret).join("[secret]") : text).slice(0, 300);
}

function authResult(prompt, error) {
  return {
    url: null,
    prompt,
    code: "auth",
    error:
      error instanceof KreaAuthError
        ? error.message
        : "Connect Krea to paint the still. Sign in and pick the Pro workspace.",
  };
}

async function readMcpBody(response) {
  const text = await response.text();
  if (!text) return {};
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/event-stream") || text.includes("\ndata:")) {
    const events = [];
    for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data || data === "[DONE]") continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        /* keepalive */
      }
    }
    return events.findLast((event) => event && (event.result || event.error)) || events.at(-1) || {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 240) } };
  }
}

async function mcpPost(token, body, sessionId, timeoutMs) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
    "User-Agent": UA,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const response = await fetch(MCP, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readMcpBody(response);
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id") || sessionId || "",
    payload,
  };
}

function rpcError(payload) {
  const message = payload?.error?.message;
  return typeof message === "string" ? message : "";
}

async function openSession(token) {
  const init = await mcpPost(
    token,
    {
      jsonrpc: "2.0",
      id: nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "factcut", version: "0.1.0" },
      },
    },
    "",
    20000,
  );
  if (init.status === 401) {
    const error = new KreaAuthError("Connect Krea again. The sign-in expired.");
    error.unauthorized = true;
    throw error;
  }
  const failed = rpcError(init.payload);
  if (init.status >= 400 || failed) {
    throw new Error(scrub(failed || `Krea MCP returned ${init.status}`, token));
  }
  await mcpPost(token, { jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId, 15000);
  return init.sessionId;
}

async function callTool(token, sessionId, name, args, options = {}) {
  const response = await mcpPost(
    token,
    {
      jsonrpc: "2.0",
      id: nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    },
    sessionId,
    options.timeoutMs || (/generat|enhance|execute_node/i.test(name) ? 45000 : 15000),
  );
  if (response.status === 401) {
    const error = new KreaAuthError("Connect Krea again. The sign-in expired.");
    error.unauthorized = true;
    throw error;
  }
  const failed = rpcError(response.payload);
  if (failed) throw new Error(scrub(failed, token));
  return readToolResult(response.payload, options);
}

function schemaFromToolMessage(message) {
  const result = message?.result && typeof message.result === "object" ? message.result : {};
  const candidates = [];
  if (result.structuredContent && typeof result.structuredContent === "object") {
    candidates.push(result.structuredContent);
  }
  const texts = Array.isArray(result.content) ? result.content : [];
  for (const item of texts) {
    if (!item || item.type !== "text" || !item.text) continue;
    try {
      const value = JSON.parse(item.text);
      if (value && typeof value === "object") candidates.push(value);
    } catch {
      /* prose */
    }
  }
  for (const candidate of candidates) {
    if (candidate.inputSchema?.properties) return candidate.inputSchema;
    if (candidate.input_schema?.properties) return candidate.input_schema;
    if (candidate.schema?.properties) return candidate.schema;
    if (candidate.properties?.prompt || candidate.properties?.duration) return candidate;
  }
  return null;
}

async function loadVideoSchema(token, sessionId, tools) {
  const tool = tools.find((item) => item?.name === "get_model_schema");
  if (!tool?.name) return null;
  const props = (tool.inputSchema || tool.input_schema)?.properties || {};
  const key = ["model", "modelId", "model_id", "id"].find((name) => props[name]) || "model";
  try {
    const response = await mcpPost(
      token,
      {
        jsonrpc: "2.0",
        id: nextId(),
        method: "tools/call",
        params: { name: tool.name, arguments: { [key]: VIDEO_MODEL } },
      },
      sessionId,
      20000,
    );
    if (response.status === 401) {
      const error = new KreaAuthError("Connect Krea again. The sign-in expired.");
      error.unauthorized = true;
      throw error;
    }
    if (rpcError(response.payload)) return null;
    return schemaFromToolMessage(response.payload);
  } catch (error) {
    if (error?.unauthorized) throw error;
    return null;
  }
}

function stillError(prompt, text) {
  const message = text || "Krea generation failed.";
  if (/compute/i.test(message)) return { url: null, prompt, code: "compute", error: message };
  return { url: null, prompt, error: message };
}

async function paintWith(token, prompt) {
  const sessionId = await openSession(token);
  const listed = await mcpPost(
    token,
    { jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} },
    sessionId,
    20000,
  );
  if (listed.status === 401) {
    const error = new KreaAuthError("Connect Krea again. The sign-in expired.");
    error.unauthorized = true;
    throw error;
  }
  const listFailed = rpcError(listed.payload);
  if (listFailed) throw new Error(scrub(listFailed, token));
  const tools = Array.isArray(listed.payload?.result?.tools) ? listed.payload.result.tools : [];
  const schemaOf = (tool) => tool?.inputSchema || tool?.input_schema || null;
  const imageTool = pickImageTool(tools);
  if (!imageTool?.name) {
    const names = tools.map((tool) => tool?.name).filter(Boolean);
    const shown = names.filter((name) => /generat|job|model/i.test(name)).slice(0, 8);
    return {
      url: null,
      prompt,
      error: shown.length
        ? `Krea has no image tool. Tools: ${shown.join(", ")}.`
        : "Krea returned no tools.",
    };
  }
  const jobTool = pickJobTool(tools);
  const generated = await callTool(
    token,
    sessionId,
    imageTool.name,
    generateArguments(schemaOf(imageTool), prompt),
  );
  if (generated.errorText) return stillError(prompt, scrub(generated.errorText, token));
  if (generated.url) return { url: generated.url, prompt };
  if (!generated.jobId) return { url: null, prompt, error: "Krea did not return a job id." };

  const deadline = Date.now() + 80000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await callTool(
      token,
      sessionId,
      jobTool?.name || "get_job",
      jobArguments(schemaOf(jobTool), generated.jobId),
    );
    if (current.url) return { url: current.url, prompt };
    if (current.errorText) return stillError(prompt, scrub(current.errorText, token));
    if (["failed", "error", "cancelled", "canceled"].includes(current.status)) {
      return stillError(prompt, "Krea generation failed.");
    }
  }
  return { url: null, prompt, error: "Krea is still rendering. Run the cut again." };
}

async function filmWith(token, brief) {
  const snap = snapClip(brief);
  const prompt = clipPrompt(snap.subject, snap.motion);
  const sessionId = await openSession(token);
  const listed = await mcpPost(
    token,
    { jsonrpc: "2.0", id: nextId(), method: "tools/list", params: {} },
    sessionId,
    20000,
  );
  if (listed.status === 401) {
    const error = new KreaAuthError("Connect Krea again. The sign-in expired.");
    error.unauthorized = true;
    throw error;
  }
  const listFailed = rpcError(listed.payload);
  if (listFailed) throw new Error(scrub(listFailed, token));
  const tools = Array.isArray(listed.payload?.result?.tools) ? listed.payload.result.tools : [];
  const schemaOf = (tool) => tool?.inputSchema || tool?.input_schema || null;
  const videoTool = pickVideoTool(tools);
  if (!videoTool?.name) {
    const names = tools.map((tool) => tool?.name).filter(Boolean);
    const shown = names.filter((name) => /generat|job|model/i.test(name)).slice(0, 8);
    return {
      url: null,
      prompt,
      error: shown.length ? `Krea has no video tool. Tools: ${shown.join(", ")}.` : "Krea returned no tools.",
    };
  }
  const loaded = await loadVideoSchema(token, sessionId, tools);
  const nested = loaded?.properties?.input?.properties;
  const flat = nested?.prompt || nested?.duration ? { properties: nested } : loaded;
  const modelSchema = flat?.properties?.duration || flat?.properties?.resolution ? flat : LTX_INPUT_SCHEMA;
  const jobTool = pickJobTool(tools);
  const generated = await callTool(
    token,
    sessionId,
    videoTool.name,
    videoArguments(schemaOf(videoTool), modelSchema, { ...snap, prompt }),
    { prefer: "video", timeoutMs: 60000 },
  );
  if (generated.errorText) return stillError(prompt, scrub(generated.errorText, token));
  if (generated.url) return { url: generated.url, prompt };
  if (!generated.jobId) return { url: null, prompt, error: "Krea did not return a job id." };

  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const current = await callTool(
      token,
      sessionId,
      jobTool?.name || "get_job",
      jobArguments(schemaOf(jobTool), generated.jobId),
      { prefer: "video" },
    );
    if (current.url) return { url: current.url, prompt };
    if (current.errorText) return stillError(prompt, scrub(current.errorText, token));
    if (["failed", "error", "cancelled", "canceled"].includes(current.status)) {
      return stillError(prompt, "Krea generation failed.");
    }
  }
  return { url: null, prompt, error: "Krea is still rendering. Cut the clip again." };
}

function clipAuth(prompt, error) {
  return {
    url: null,
    prompt,
    code: "auth",
    error:
      error instanceof KreaAuthError
        ? error.message
        : "Connect Krea to cut the clip. Sign in and pick the Pro workspace.",
  };
}

export async function kreaClip(brief) {
  const prompt = clipPrompt(brief?.subject, brief?.motion);
  let token = "";
  try {
    token = await kreaAccessToken();
  } catch (error) {
    return clipAuth(prompt, error);
  }
  try {
    return await filmWith(token, brief);
  } catch (error) {
    if (!error?.unauthorized) return stillError(prompt, scrub(error.message, token));
    try {
      token = await kreaAccessToken({ force: true });
      return await filmWith(token, brief);
    } catch (retry) {
      if (retry?.code === "auth" || retry?.unauthorized) return clipAuth(prompt, retry);
      return stillError(prompt, scrub(retry.message, token));
    }
  }
}

export async function kreaStill(prompt) {
  let token = "";
  try {
    token = await kreaAccessToken();
  } catch (error) {
    return authResult(prompt, error);
  }
  try {
    return await paintWith(token, prompt);
  } catch (error) {
    if (!error?.unauthorized) return stillError(prompt, scrub(error.message, token));
    try {
      token = await kreaAccessToken({ force: true });
      return await paintWith(token, prompt);
    } catch (retry) {
      if (retry?.code === "auth" || retry?.unauthorized) return authResult(prompt, retry);
      return stillError(prompt, scrub(retry.message, token));
    }
  }
}
