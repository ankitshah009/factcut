const STOP = new Set(
  "a an the of to and or for in on with from by at as is are was were be this that it its their your our into over than then not no".split(
    " ",
  ),
);

// A claim that uses one of these words is unsupported unless that word itself is in the Cala text.
const POLARITY = new Set(
  "ban bans banned prohibit prohibits prohibited forbid forbids forbidden illegal never always every block blocks".split(
    " ",
  ),
);

const DOCUMENTARY =
  "Documentary photo, natural light, no text, no numbers, no logos, no charts.";

function numericCore(raw) {
  return String(raw).replace(/,/g, "").replace(/\.+$/g, "");
}

// Commas may appear or not. A trailing sentence period is not part of the number.
function numberInCorpus(raw, corpus) {
  const core = numericCore(raw);
  if (!core) return false;
  let body = "";
  for (let i = 0; i < core.length; i += 1) {
    const ch = core[i];
    body += ch === "." ? "\\." : ch;
    const next = core[i + 1];
    if (/\d/.test(ch) && next && /\d/.test(next)) body += ",?";
  }
  return new RegExp(`(?:^|[^\\d])${body}(?=$|[^\\d])`).test(corpus);
}

export function judgeClaim(claim, corpus) {
  const text = typeof claim === "string" ? claim : String(claim ?? "");
  const haystack = typeof corpus === "string" ? corpus : JSON.stringify(corpus ?? "");
  const haystackLower = haystack.toLowerCase();
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const content = words.filter((word) => !STOP.has(word));
  const needed = Math.min(2, content.length);
  const matched = [];
  let hits = 0;
  for (const word of content) {
    if (word.length <= 2 || !haystackLower.includes(word)) continue;
    hits += 1;
    if (!matched.includes(word)) matched.push(word);
  }
  const numbers = text.match(/\d[\d,.]*/g) ?? [];
  const numbersOk = numbers.every((num) => numberInCorpus(num, haystack));
  const polarityOk = content.every((word) => !POLARITY.has(word) || haystackLower.includes(word));
  const status = hits >= needed && numbersOk && polarityOk ? "supported" : "unsupported";
  return { text, status, matched };
}

function evidenceCorpus(rows, note) {
  const prose = typeof note === "string" ? note : "";
  return `${JSON.stringify(rows || [])}\n${prose}`;
}

function proseWords(note) {
  return String(note || "").match(/[a-z0-9]+/gi) ?? [];
}

function gradeFor(score) {
  if (score >= 70) return "grounded";
  if (score >= 40) return "partial";
  return "unsupported";
}

export function scoreInformation({ rows, sources, claims, note } = {}) {
  const rowList = Array.isArray(rows) ? rows : [];
  const sourceList = Array.isArray(sources) ? sources : [];
  const claimList = Array.isArray(claims) ? claims : [];
  const prose = typeof note === "string" ? note.trim() : "";
  const judged = claimList.map((claim) => judgeClaim(String(claim), evidenceCorpus(rows, prose)));
  const notes = [];
  let score = 20;

  if (rowList.length >= 4) {
    score += 30;
    notes.push(`${rowList.length} Cala rows (+30).`);
  } else if (rowList.length >= 1) {
    score += 18;
    notes.push(`${rowList.length} Cala row${rowList.length === 1 ? "" : "s"} (+18).`);
  } else if (proseWords(prose).length >= 40) {
    score += 18;
    notes.push("Cala answered in prose (+18).");
  } else {
    score -= 5;
    notes.push("No Cala rows (-5).");
  }

  if (sourceList.length >= 2) {
    score += 20;
    notes.push(`${sourceList.length} sources (+20).`);
  } else if (sourceList.length === 1) {
    score += 10;
    notes.push("1 source (+10).");
  } else {
    notes.push("No sources.");
  }

  if (judged.length === 0) {
    notes.push(
      "No claims supplied. The score is about the query result, not lines spoken in the video.",
    );
  } else {
    const supported = judged.filter((claim) => claim.status === "supported").length;
    const unsupported = judged.length - supported;
    if (supported) {
      score += supported * 8;
      notes.push(
        `${supported} supported claim${supported === 1 ? "" : "s"} (+${supported * 8}).`,
      );
    }
    if (unsupported) {
      score -= unsupported * 12;
      notes.push(
        `${unsupported} unsupported claim${unsupported === 1 ? "" : "s"} (-${unsupported * 12}).`,
      );
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, grade: gradeFor(score), notes, claims: judged };
}

function proseSubject(note) {
  const body = String(note || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ");
  const sentence = body
    .replace(/[#*_`>]/g, " ")
    .split(/(?<=[.!?])\s/)[0];
  const cleaned = sentence
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\w*\d\w*\b/g, " ")
    .replace(/[^A-Za-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter((word) => word && word.toLowerCase() !== "that");
  if (words.length < 4) return "";
  return words.slice(0, 18).join(" ");
}

export function stillPrompt(rows, note) {
  const row = Array.isArray(rows) ? rows[0] : null;
  const values = [];
  if (row && typeof row === "object" && !Array.isArray(row)) {
    for (const value of Object.values(row)) {
      if (values.length >= 3) break;
      if (typeof value !== "string") continue;
      const clean = value.trim();
      if (!clean || /\d/.test(clean)) continue;
      values.push(clean);
    }
  }
  if (values.length) {
    return `Documentary photo of ${values.join(", ")}, natural light, no text, no numbers, no logos, no charts.`;
  }
  const subject = proseSubject(note);
  if (!subject || /\d/.test(subject)) return DOCUMENTARY;
  return `Documentary photo of ${subject}, natural light, no text, no numbers, no logos, no charts.`;
}
