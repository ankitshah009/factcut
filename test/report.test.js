import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeClaim, scoreInformation, stillPrompt } from "../lib/report.js";

const holdingRows = [
  { name: "WPP", headquarters: "London", founded: 1985 },
  { name: "Publicis", headquarters: "Paris", founded: 1926 },
  { name: "Omnicom", headquarters: "New York", founded: 1986 },
  { name: "Dentsu", headquarters: "Tokyo", founded: 1901 },
];

test("supported when enough content words and every number match", () => {
  const corpus = JSON.stringify(holdingRows);
  const supported = judgeClaim("WPP is headquartered in London.", corpus);
  assert.equal(supported.status, "supported");
  assert.equal(supported.text, "WPP is headquartered in London.");
  assert.ok(supported.matched.includes("wpp"));
  assert.ok(supported.matched.includes("london"));

  const oneWord = judgeClaim("Publicis", corpus);
  assert.equal(oneWord.status, "supported");
  assert.deepEqual(oneWord.matched, ["publicis"]);

  const extraWords = judgeClaim("WPP quietly leads London advertising.", corpus);
  assert.equal(extraWords.status, "supported");
  assert.ok(extraWords.matched.includes("wpp"));
  assert.ok(extraWords.matched.includes("london"));
});

test("unsupported when words or numbers do not match", () => {
  const corpus = JSON.stringify(holdingRows);
  const wrongNumber = judgeClaim("WPP was founded in 1971.", corpus);
  assert.equal(wrongNumber.status, "unsupported");
  assert.ok(wrongNumber.matched.includes("wpp"));

  const missingWords = judgeClaim("Havas dominates advertising.", corpus);
  assert.equal(missingWords.status, "unsupported");

  const onlyOneLongWord = judgeClaim("WPP dominates advertising.", corpus);
  assert.equal(onlyOneLongWord.status, "unsupported");

  const shortTokens = judgeClaim("US HQ", corpus);
  assert.equal(shortTokens.status, "unsupported");

  const nestedNumber = judgeClaim("SPF 100 blocks every ultraviolet ray.", corpus);
  assert.equal(nestedNumber.status, "unsupported");
  assert.equal(
    judgeClaim("The code is 100.", JSON.stringify({ code: 1000 })).status,
    "unsupported",
  );
});

test("numbers match with optional commas and a trailing period", () => {
  const corpus = JSON.stringify([{ name: "WPP", founded: 1985, revenue: 40000000 }]);
  assert.equal(judgeClaim("WPP was founded in 1985.", corpus).status, "supported");
  assert.equal(
    judgeClaim("WPP revenue reached 40,000,000.", corpus).status,
    "supported",
  );
  assert.equal(
    judgeClaim("WPP revenue reached 40000000 after tax.", "revenue 40,000,000 after tax").status,
    "supported",
  );
  assert.equal(judgeClaim("WPP was founded in 1984.", corpus).status, "unsupported");
});

test("information score grades, clamps, and notes", () => {
  const grounded = scoreInformation({
    rows: holdingRows,
    sources: ["https://a.example", "https://b.example"],
    claims: ["WPP is headquartered in London."],
  });
  assert.equal(grounded.score, 78);
  assert.equal(grounded.grade, "grounded");
  assert.equal(grounded.claims[0].status, "supported");
  assert.ok(grounded.notes.some((note) => note.includes("(+30)")));
  assert.ok(grounded.notes.some((note) => note.includes("(+8)")));
  assert.equal(
    grounded.notes.some((note) => /lines spoken in the video/i.test(note)),
    false,
  );

  const boundary = scoreInformation({
    rows: holdingRows,
    sources: ["https://a.example", "https://b.example"],
    claims: [],
  });
  assert.equal(boundary.score, 70);
  assert.equal(boundary.grade, "grounded");
  assert.ok(
    boundary.notes.some(
      (note) => /query result/i.test(note) && /lines spoken in the video/i.test(note),
    ),
  );

  const partial = scoreInformation({
    rows: holdingRows.slice(0, 1),
    sources: ["https://a.example"],
    claims: [],
  });
  assert.equal(partial.score, 48);
  assert.equal(partial.grade, "partial");

  const mixed = scoreInformation({
    rows: holdingRows,
    sources: ["https://a.example", "https://b.example"],
    claims: ["WPP is headquartered in London.", "Havas dominates advertising."],
  });
  assert.equal(mixed.score, 66);
  assert.equal(mixed.grade, "partial");
  assert.deepEqual(
    mixed.claims.map((claim) => claim.status),
    ["supported", "unsupported"],
  );

  const exactPartial = scoreInformation({
    rows: [{ name: "WPP", headquarters: "London" }],
    sources: ["https://a.example"],
    claims: [
      "WPP is headquartered in London.",
      "London hosts WPP.",
      "Omnicom is headquartered in New York.",
      "Dentsu opened 1881 offices.",
    ],
  });
  assert.equal(exactPartial.score, 40);
  assert.equal(exactPartial.grade, "partial");

  const below = scoreInformation({
    rows: holdingRows.slice(0, 1),
    sources: [],
    claims: [],
  });
  assert.equal(below.score, 38);
  assert.equal(below.grade, "unsupported");

  const empty = scoreInformation({});
  assert.equal(empty.score, 15);
  assert.equal(empty.grade, "unsupported");
  assert.deepEqual(empty.claims, []);
  assert.deepEqual(empty.notes, [
    "No Cala rows (-5).",
    "No sources.",
    "No claims supplied. The score is about the query result, not lines spoken in the video.",
  ]);

  const floored = scoreInformation({
    rows: [],
    sources: [],
    claims: ["Havas wins.", "Omnicom wins.", "Dentsu wins."],
  });
  assert.equal(floored.score, 0);
  assert.equal(floored.grade, "unsupported");

  const capped = scoreInformation({
    rows: holdingRows,
    sources: ["https://a.example", "https://b.example"],
    claims: [
      "WPP is headquartered in London.",
      "Publicis is headquartered in Paris.",
      "Omnicom is headquartered in New York.",
      "Dentsu is headquartered in Tokyo.",
    ],
  });
  assert.equal(capped.score, 100);
  assert.equal(capped.grade, "grounded");
  assert.equal(
    capped.claims.every((claim) => claim.status === "supported"),
    true,
  );
});

test("a prose Cala answer grounds the disclosure claim and rejects the ban", () => {
  const note = [
    "The EU AI Act includes specific transparency obligations under Article 50",
    "that directly affect AI-generated advertising and synthetic media.",
    "Deployers must disclose to end users that the content is artificially generated.",
    "This applies to deepfakes and synthetic content.",
    "Fines can reach 15 million. The rules became applicable on 2 August 2026.",
    "Not all AI-assisted advertising requires a public label.",
  ].join(" ");
  const scored = scoreInformation({
    rows: [],
    sources: ["https://a.example", "https://b.example"],
    claims: [
      "Sellers must disclose realistic synthetic commercial media.",
      "The EU AI Act bans all advertising.",
    ],
    note,
  });
  assert.deepEqual(
    scored.claims.map((claim) => claim.status),
    ["supported", "unsupported"],
  );
  assert.equal(scored.score, 54);
  assert.equal(scored.grade, "partial");
  assert.ok(scored.notes.some((line) => line.includes("prose (+18)")));
  assert.equal(
    scored.notes.some((line) => line.includes("No Cala rows")),
    false,
  );

  const prompt = stillPrompt([], `## EU AI Act: Disclosure Requirements\n\n${note}`);
  assert.match(prompt, /synthetic media/i);
  assert.doesNotMatch(prompt, /\d/);
  assert.doesNotMatch(prompt, /Requirements/);
  assert.match(prompt, /no numbers/i);
});

test("stillPrompt keeps a digit-free name and drops funding digits", () => {
  const prompt = stillPrompt([
    {
      name: "Publicis",
      funding: "$40M",
      headquarters: "Paris",
      founded: 1926,
      note: "ranked 4",
    },
    { name: "WPP", funding: "$9" },
  ]);
  assert.match(prompt, /Publicis/);
  assert.match(prompt, /Paris/);
  assert.doesNotMatch(prompt, /WPP/);
  assert.doesNotMatch(prompt, /\$40M/);
  assert.doesNotMatch(prompt, /40M/);
  assert.doesNotMatch(prompt, /ranked/);
  assert.doesNotMatch(prompt, /1926/);
  assert.doesNotMatch(prompt, /\d/);
  assert.match(prompt, /documentary photo/i);
  assert.match(prompt, /natural light/i);
  assert.match(prompt, /no text/i);
  assert.match(prompt, /no numbers/i);
  assert.match(prompt, /no logos/i);
  assert.match(prompt, /no charts/i);

  const capped = stillPrompt([
    {
      name: "Acme",
      city: "Oslo",
      owner: "Northwind",
      motto: "Keep looking",
      funding: "$40M",
    },
  ]);
  assert.match(capped, /Acme/);
  assert.match(capped, /Oslo/);
  assert.match(capped, /Northwind/);
  assert.doesNotMatch(capped, /Keep looking/);
  assert.doesNotMatch(capped, /\d/);

  for (const rows of [undefined, null, [], [{ funding: "$40M", founded: 1999 }]]) {
    const generic = stillPrompt(rows);
    assert.match(generic, /documentary photo/i);
    assert.match(generic, /natural light/i);
    assert.doesNotMatch(generic, /\d/);
    assert.doesNotMatch(generic, /\$40M/);
    assert.doesNotMatch(generic, /Publicis|Acme|WPP/);
  }
});
