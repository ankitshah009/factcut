import assert from "node:assert/strict";
import test from "node:test";
import { judgeClaim, scoreInformation, stillPrompt } from "../lib/report.js";

const rows = [
  { name: "WPP", headquarters: "London", funding: "$40M", founded: 1985 },
];

test("a claim is supported only when words and numbers are in the rows", () => {
  const corpus = JSON.stringify(rows);
  const hit = judgeClaim("WPP is headquartered in London", corpus);
  assert.equal(hit.status, "supported");
  const punctuated = judgeClaim("WPP is headquartered in London.", JSON.stringify([
    { name: "WPP PLC", headquarters: "London, United Kingdom" },
  ]));
  assert.equal(punctuated.status, "supported");
  assert.ok(punctuated.matched.includes("london"));
  const miss = judgeClaim("WPP raised $90M in 2024", corpus);
  assert.equal(miss.status, "unsupported");
});

test("information grades move with rows, sources, and claims", () => {
  const grounded = scoreInformation({
    rows: [rows[0], { name: "Omnicom" }, { name: "Publicis" }, { name: "Dentsu" }],
    sources: [{ url: "https://a.example" }, { url: "https://b.example" }],
    claims: ["WPP is headquartered in London"],
  });
  assert.equal(grounded.grade, "grounded");
  const bare = scoreInformation({ rows: [], sources: [], claims: ["WPP owns every agency"] });
  assert.equal(bare.grade, "unsupported");
});

test("the still prompt keeps the name and drops digit fields", () => {
  const prompt = stillPrompt(rows);
  assert.match(prompt, /WPP/);
  assert.match(prompt, /London/);
  assert.doesNotMatch(prompt, /40/);
  assert.doesNotMatch(prompt, /1985/);
  assert.doesNotMatch(prompt, /\$/);
});
