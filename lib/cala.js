const BASE = "https://api.cala.ai";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unwrapRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const inner = row.data || row.row || row.fields || row.entity;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const keys = Object.keys(row);
    if (keys.length <= 4) return inner;
  }
  return row;
}

export function parseQuery(data) {
  const source = Array.isArray(data) ? { results: data } : data || {};
  const bucket =
    source.results ||
    source.rows ||
    source.records ||
    source.data ||
    [];
  const rows = asArray(bucket).map(unwrapRow).filter(Boolean);
  const entities = asArray(source.entities || source.matching_entities);
  return { rows, entities };
}

function pushSource(list, name, url) {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
  list.push({ name: name || "Source", url });
}

function walkSources(node, list, depth) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) walkSources(item, list, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  pushSource(list, node.name || node.title, node.url);
  if (node.origin) walkSources(node.origin, list, depth + 1);
  if (node.document) walkSources(node.document, list, depth + 1);
  if (node.source) walkSources(node.source, list, depth + 1);
  for (const key of ["origins", "sources", "documents", "citations"]) {
    if (node[key]) walkSources(node[key], list, depth + 1);
  }
}

export function parseSearch(data) {
  const source = data || {};
  const answer =
    source.answer ||
    source.output ||
    source.markdown ||
    source.response ||
    source.text ||
    (typeof source.content === "string" ? source.content : "") ||
    "";
  const found = [];
  walkSources(source.context || source.contexts || source.results, found, 0);
  walkSources(source.origins, found, 0);
  walkSources(source.sources, found, 0);
  const seen = new Set();
  const sources = [];
  for (const item of found) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    sources.push(item);
  }
  return {
    answer: typeof answer === "string" ? answer : "",
    sources,
  };
}

async function post(path, input) {
  const key = process.env.CALA_API_KEY;
  if (!key) {
    throw new Error("CALA_API_KEY is not set");
  }
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key,
    },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message =
      body.message ||
      body.error?.message ||
      body.detail ||
      `Cala returned ${response.status}`;
    throw new Error(String(message).replace(key, "[key]"));
  }
  return body;
}

export async function calaQuery(input) {
  return parseQuery(await post("/v1/knowledge/query", input));
}

export async function calaSearch(input) {
  return parseSearch(await post("/v1/knowledge/search", input));
}
