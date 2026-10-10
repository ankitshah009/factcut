const STOP = new Set(
  "a an the of to and or for in on with from by at as is are was were be this that it its their your our into over than then not no".split(
    " ",
  ),
);

function contentTokens(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

export function judgeClaim(claim, corpus) {
  const haystack = String(corpus || "").toLowerCase();
  const words = contentTokens(claim);
  const matched = words.filter((word) => haystack.includes(word.toLowerCase()));
  const numbers = String(claim).match(/\d[\d,.]*/g) || [];
  const numbersOk = numbers.every((number) => {
    const plain = number.replace(/,/g, "");
    return haystack.includes(number.toLowerCase()) || haystack.includes(plain);
  });
  const needed = Math.min(2, words.length);
  const supported = words.length > 0 && matched.length >= needed && numbersOk;
  return {
    text: claim,
    status: supported ? "supported" : "unsupported",
    matched,
  };
}

export function scoreInformation({ rows, sources, claims }) {
  const list = Array.isArray(rows) ? rows : [];
  const sourceList = Array.isArray(sources) ? sources : [];
  const claimList = (claims || []).map((claim) => String(claim).trim()).filter(Boolean);
  const corpus = JSON.stringify(list);
  const judged = claimList.map((claim) => judgeClaim(claim, corpus));
  let score = 20;
  const notes = [];

  if (list.length >= 4) {
    score += 30;
    notes.push(`${list.length} structured rows came back from the Cala query.`);
  } else if (list.length >= 1) {
    score += 18;
    notes.push(
      `${list.length} structured row${list.length > 1 ? "s" : ""} from the Cala query. Thin, but typed.`,
    );
  } else {
    score -= 5;
    notes.push("The Cala query returned no rows.");
  }

  if (sourceList.length >= 2) {
    score += 20;
    notes.push(`${sourceList.length} sources attached.`);
  } else if (sourceList.length === 1) {
    score += 10;
    notes.push("One source attached.");
  } else {
    notes.push("No source URLs on this answer.");
  }

  if (judged.length) {
    const supported = judged.filter((claim) => claim.status === "supported").length;
    notes.push(
      `${supported} of ${judged.length} supplied claims show up in the query rows.`,
    );
    score += supported * 8;
    score -= (judged.length - supported) * 12;
  } else {
    notes.push(
      "No claims were supplied, so this score is about the query result, not lines spoken in the video.",
    );
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 70 ? "grounded" : score >= 40 ? "partial" : "unsupported";
  return { score, grade, notes, claims: judged };
}

export function stillPrompt(rows) {
  const row = rows?.[0];
  if (!row || typeof row !== "object") {
    return "Quiet documentary still, natural light, no text, no numbers, no logos, no charts.";
  }
  const bits = Object.values(row)
    .filter((value) => typeof value === "string" && value.trim() && !/\d/.test(value))
    .map((value) => value.trim())
    .slice(0, 3);
  const subject = bits[0] || "the subject of a research still";
  const rest = bits.slice(1).join(", ");
  return [
    "Documentary photograph, natural light, 35mm, no illustration.",
    `Subject: ${subject}${rest ? `. Context: ${rest}` : ""}.`,
    "No text, no letters, no numbers, no logos, no charts, no before-and-after, no watermarks.",
  ].join(" ");
}
