export const VIDEO_MODEL = "lightricks/ltx-video-2.5-fast";

export const CLIP_MOTIONS = [
  { id: "dolly_in", label: "Dolly in", line: "The camera dollies in." },
  { id: "dolly_out", label: "Dolly out", line: "The camera dollies out." },
  { id: "dolly_left", label: "Dolly left", line: "The camera dollies left." },
  { id: "dolly_right", label: "Dolly right", line: "The camera dollies right." },
  { id: "jib_up", label: "Jib up", line: "The camera rises on a jib." },
  { id: "jib_down", label: "Jib down", line: "The camera lowers on a jib." },
  { id: "static", label: "Static", line: "The camera holds still." },
  { id: "focus_shift", label: "Focus shift", line: "Focus shifts through the shot." },
];

export const CLIP_LENGTHS = [6, 8, 10, 12, 14, 16, 18, 20];
export const CLIP_ASPECTS = ["16:9", "9:16"];

const RESOLUTION_RANK = ["1080p", "1440p", "4k", "768p", "720p", "480p"];
const TAIL = "No text, no numbers, no logos, no charts.";

export const LTX_INPUT_SCHEMA = {
  properties: {
    prompt: { type: "string" },
    start_image: {},
    aspect_ratio: { enum: ["16:9", "9:16"] },
    duration: { anyOf: CLIP_LENGTHS.map((value) => ({ const: value })) },
    resolution: { enum: ["720p", "1080p", "1440p", "4k"] },
    generate_audio: { type: "boolean" },
    camera_motion: { enum: CLIP_MOTIONS.map((item) => item.id) },
  },
};

function motionById(id) {
  return CLIP_MOTIONS.find((item) => item.id === id) || CLIP_MOTIONS[0];
}

function httpsUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function snapClip(input = {}) {
  const motion = motionById(String(input?.motion || ""));
  const durationNumber = Number(input?.duration);
  const duration = CLIP_LENGTHS.includes(durationNumber) ? durationNumber : 6;
  const aspect = CLIP_ASPECTS.includes(input?.aspect) ? input.aspect : "16:9";
  const audio = input?.audio !== false && input?.audio !== "false";
  return {
    subject: typeof input?.subject === "string" ? input.subject : "",
    motion: motion.id,
    duration,
    aspect,
    audio,
    startImage: httpsUrl(input?.startImage),
  };
}

// Duration and resolution stay model parameters. The prompt string cannot carry digits.
export function clipPrompt(subject, motionId) {
  const motion = motionById(motionId);
  let text = String(subject || "")
    .replace(/\bphotos?\b/gi, (word) => (word.toLowerCase() === "photos" ? "shots" : "shot"))
    .replace(/\b\d+p\b/gi, " ")
    .replace(/\b\d+k\b/gi, " ")
    .replace(/\b\d[\d,.]*/g, " ")
    .replace(/[^a-zA-Z\s,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,.\s]*no text.*$/i, "")
    .replace(/[,.\s]+$/g, "")
    .trim();
  if (text.length < 8) text = "Documentary shot, natural light";
  text = text.replace(/\.+$/g, "");
  const line = motion.line.replace(/\.$/, "");
  return `${text}. ${line}. ${TAIL}`;
}

function enumValues(schema) {
  if (!schema || typeof schema !== "object") return null;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum.map(String);
  if (Array.isArray(schema.anyOf)) {
    const consts = schema.anyOf.map((item) => item?.const).filter((value) => value != null);
    if (consts.length) return consts.map(String);
  }
  return null;
}

function durationConsts(schema) {
  if (!schema || typeof schema !== "object") return null;
  const fromList = (list) => list.map(Number).filter((value) => Number.isFinite(value));
  if (Array.isArray(schema.anyOf)) {
    const consts = fromList(schema.anyOf.map((item) => item?.const));
    if (consts.length) return consts;
  }
  if (Array.isArray(schema.enum)) {
    const nums = fromList(schema.enum);
    if (nums.length) return nums;
  }
  return null;
}

export function videoArguments(toolSchema, modelSchema, brief) {
  const snap = snapClip(brief || {});
  const given = typeof brief?.prompt === "string" ? brief.prompt.trim() : "";
  const prompt = given || clipPrompt(snap.subject, snap.motion);
  const modelProps =
    modelSchema?.properties && typeof modelSchema.properties === "object" ? modelSchema.properties : null;
  const toolProps =
    toolSchema?.properties && typeof toolSchema.properties === "object" ? toolSchema.properties : null;
  const allow = (key) => !modelProps || Boolean(modelProps[key]);
  const input = { prompt };

  if (allow("aspect_ratio")) {
    const allowed = enumValues(modelProps?.aspect_ratio);
    if (!allowed) input.aspect_ratio = snap.aspect;
    else if (allowed.includes(snap.aspect)) input.aspect_ratio = snap.aspect;
    else if (allowed.includes("16:9")) input.aspect_ratio = "16:9";
    else input.aspect_ratio = allowed[0];
  }

  if (allow("duration")) {
    const allowed = durationConsts(modelProps?.duration);
    if (!allowed) input.duration = snap.duration;
    else if (allowed.includes(snap.duration)) input.duration = snap.duration;
    else input.duration = allowed[0];
  }

  if (allow("resolution")) {
    const allowed = enumValues(modelProps?.resolution);
    input.resolution = allowed
      ? RESOLUTION_RANK.find((item) => allowed.includes(item)) || allowed[0]
      : "1080p";
  }

  if (allow("generate_audio")) input.generate_audio = snap.audio;

  if (allow("camera_motion")) {
    const allowed = enumValues(modelProps?.camera_motion);
    if (!allowed) input.camera_motion = snap.motion;
    else if (allowed.includes(snap.motion)) input.camera_motion = snap.motion;
    else if (allowed.includes("dolly_in")) input.camera_motion = "dolly_in";
    else input.camera_motion = allowed[0];
  }

  if (allow("start_image") && snap.startImage) input.start_image = snap.startImage;

  const modelKey = ["model", "model_id", "modelId", "endpoint"].find((key) => toolProps?.[key]);
  if (!toolProps || toolProps.input) {
    const args = { input };
    args[modelKey || "model"] = VIDEO_MODEL;
    if (toolProps?.sync) args.sync = false;
    if (toolProps?.wait) args.wait = false;
    return args;
  }

  const args = {};
  if (modelKey) args[modelKey] = VIDEO_MODEL;
  for (const [key, value] of Object.entries(input)) {
    if (toolProps[key]) args[key] = value;
  }
  if (!args.prompt) args.prompt = prompt;
  if (toolProps.sync) args.sync = false;
  if (toolProps.wait) args.wait = false;
  return args;
}
