import test from "node:test";
import assert from "node:assert/strict";
import { searchWeb, SearchResultSchema } from "../src/tools/web-search/index.ts";

// ---------------------------------------------------------------------------
// Minimal Yandex XML fixture (2 docs, various edge cases)
// ---------------------------------------------------------------------------

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch version="1.0">
<response date="20260101T000000">
<results>
<grouping attr="d" mode="deep" groups-on-page="10" docs-in-group="1" curcateg="-1">
<group>
  <doc id="A">
    <url>https://nodejs.org/api/typescript.html</url>
    <domain>nodejs.org</domain>
    <title>Modules: <hlword>TypeScript</hlword> | <hlword>Node</hlword>.<hlword>js</hlword></title>
    <modtime>20240806T212821</modtime>
    <passages>
      <passage>By default <hlword>Node</hlword>.<hlword>js</hlword> will execute <hlword>TypeScript</hlword> files.</passage>
      <passage>Second snippet about <hlword>TypeScript</hlword>.</passage>
    </passages>
  </doc>
</group>
<group>
  <doc id="B">
    <url>https://www.w3schools.com/typescript/</url>
    <domain>www.w3schools.com</domain>
    <title>TypeScript Tutorial</title>
    <modtime></modtime>
    <passages>
      <passage>Only one passage here.</passage>
    </passages>
  </doc>
</group>
</grouping>
</results>
</response>
</yandexsearch>`;

const SAMPLE_RAW_DATA = Buffer.from(SAMPLE_XML).toString("base64");

function mockFetch(rawData: string): typeof fetch {
  return async () =>
    ({
      ok: true,
      json: async () => ({ rawData }),
    }) as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("searchWeb parses documents correctly", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(SAMPLE_RAW_DATA);
  try {
    process.env.YC_API_KEY = "test-key";
    process.env.YC_FOLDER_ID = "test-folder";

    const result = await searchWeb({ query: "TypeScript Node.js", page: 0 });

    assert.equal(result.query, "TypeScript Node.js");
    assert.equal(result.page, 0);
    assert.equal(result.documents.length, 2);

    const first = result.documents[0];
    assert.equal(first.url, "https://nodejs.org/api/typescript.html");
    assert.equal(first.domain, "nodejs.org");
    // hlword tags must be stripped from title
    assert.equal(first.title, "Modules: TypeScript | Node.js");
    assert.equal(first.modtime, "20240806T212821");
    assert.equal(first.passages.length, 2);
    assert.equal(first.passages[0], "By default Node.js will execute TypeScript files.");
    // hlword tags stripped from passages
    assert.ok(!first.passages[0].includes("<hlword>"));

    const second = result.documents[1];
    assert.equal(second.url, "https://www.w3schools.com/typescript/");
    assert.equal(second.modtime, null); // empty modtime → null
    assert.equal(second.passages.length, 1);
    assert.equal(second.passages[0], "Only one passage here.");
  } finally {
    globalThis.fetch = original;
  }
});

test("searchWeb output passes SearchResultSchema.parse", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(SAMPLE_RAW_DATA);
  try {
    process.env.YC_API_KEY = "test-key";
    process.env.YC_FOLDER_ID = "test-folder";

    const result = await searchWeb({ query: "test" });
    // Must not throw
    SearchResultSchema.parse(result);
  } finally {
    globalThis.fetch = original;
  }
});

test("searchWeb defaults page to 0 when omitted", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch(SAMPLE_RAW_DATA);
  try {
    process.env.YC_API_KEY = "test-key";
    process.env.YC_FOLDER_ID = "test-folder";

    const result = await searchWeb({ query: "hello" });
    assert.equal(result.page, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("searchWeb throws on missing YC_API_KEY", async () => {
  const saved = process.env.YC_API_KEY;
  delete process.env.YC_API_KEY;
  try {
    await assert.rejects(
      () => searchWeb({ query: "test" }),
      /YC_API_KEY is not set/
    );
  } finally {
    process.env.YC_API_KEY = saved;
  }
});

test("searchWeb throws on non-2xx response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    ({ ok: false, status: 401, text: async () => "Unauthorized" }) as unknown as Response;
  try {
    process.env.YC_API_KEY = "test-key";
    process.env.YC_FOLDER_ID = "test-folder";

    await assert.rejects(
      () => searchWeb({ query: "test" }),
      /Yandex Search API error 401/
    );
  } finally {
    globalThis.fetch = original;
  }
});
