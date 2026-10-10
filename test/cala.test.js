import assert from "node:assert/strict";
import test from "node:test";
import { parseQuery, parseSearch } from "../lib/cala.js";

test("parseQuery unwraps results and entities", () => {
  const parsed = parseQuery({
    results: [{ name: "WPP", headquarters: "London", founded: 1985 }],
    entities: [{ id: "1", name: "WPP", entity_type: "Company" }],
  });
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].name, "WPP");
  assert.equal(parsed.entities[0].entity_type, "Company");
});

test("parseQuery accepts a bare array", () => {
  const parsed = parseQuery([{ name: "Omnicom" }]);
  assert.equal(parsed.rows[0].name, "Omnicom");
});

test("parseSearch reads the content field as the note", () => {
  const parsed = parseSearch({
    content: "Disclosure is required for synthetic commercial media.",
    context: [
      {
        content: "Article 50 text",
        origins: [
          {
            source: { name: "EUR-Lex", url: "https://eur-lex.europa.eu/ai-act" },
            document: { name: "AI Act", url: "https://eur-lex.europa.eu/ai-act" },
          },
        ],
      },
    ],
  });
  assert.match(parsed.answer, /Disclosure is required/);
  assert.equal(parsed.sources.length, 1);
});

test("parseSearch collects nested origin urls once", () => {
  const parsed = parseSearch({
    answer: "Disclosure is required.",
    context: [
      {
        text: "Article 50",
        origin: { name: "EUR-Lex", url: "https://eur-lex.europa.eu/ai-act" },
      },
      {
        origins: [{ name: "EUR-Lex", url: "https://eur-lex.europa.eu/ai-act" }],
      },
    ],
  });
  assert.equal(parsed.answer, "Disclosure is required.");
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].name, "EUR-Lex");
});
