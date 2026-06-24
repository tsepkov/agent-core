/**
 * Yandex Web Search tool (Russian index).
 *
 * Calls the Yandex Search API v2 synchronous REST endpoint, decodes the
 * base64-encoded XML response and returns structured documents with passages.
 */
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { AgentTool } from "../../../../../packages/agent-core/src/tool/index.ts";
import type { ObjectContext } from "@restatedev/restate-sdk";

/** Yandex Search API credentials (required only when the web_search tool is used). */
export function getYandexConfig(): { apiKey: string; folderId: string } {
  const apiKey = process.env.YC_API_KEY;
  const folderId = process.env.YC_FOLDER_ID;
  if (!apiKey) throw new Error("YC_API_KEY is not set. Add it to .env or the environment.");
  if (!folderId) throw new Error("YC_FOLDER_ID is not set. Add it to .env or the environment.");
  return { apiKey, folderId };
}

// ---------------------------------------------------------------------------
// Output schema (also used to validate the live API response)
// ---------------------------------------------------------------------------

const DocumentSchema = z.object({
  url: z.string(),
  domain: z.string(),
  title: z.string(),
  /** ISO-like Yandex modtime string (e.g. "20240806T212821") or null. */
  modtime: z.string().nullable(),
  passages: z.array(z.string()),
});

export const SearchResultSchema = z.object({
  query: z.string(),
  page: z.number(),
  documents: z.array(DocumentSchema),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

// ---------------------------------------------------------------------------
// Core search function (pure, no Restate — separately testable)
// ---------------------------------------------------------------------------

/** Strip `<hlword>` / `</hlword>` highlighting tags from a parser raw-text string. */
function stripHlword(s: string): string {
  return s.replace(/<\/?hlword>/g, "");
}

const parser = new XMLParser({
  // Keep title/passage text raw so hlword tags aren't parsed as child nodes.
  stopNodes: ["*.title", "*.passage"],
  // Force these to always be arrays, even when only one element is present.
  isArray: (name) => ["group", "passage"].includes(name),
});

export async function searchWeb(input: { query: string; page?: number }): Promise<SearchResult> {
  const { apiKey, folderId } = getYandexConfig();
  const page = input.page ?? 0;

  const body = {
    query: {
      searchType: "SEARCH_TYPE_RU",
      queryText: input.query,
      familyMode: "FAMILY_MODE_NONE",
      page: String(page),
      fixTypoMode: "FIX_TYPO_MODE_ON",
    },
    sortSpec: {
      sortMode: "SORT_MODE_BY_RELEVANCE",
      sortOrder: "SORT_ORDER_DESC",
    },
    groupSpec: {
      groupMode: "GROUP_MODE_DEEP",
      groupsOnPage: "10",
      docsInGroup: "1",
    },
    maxPassages: "4",
    l10n: "LOCALIZATION_RU",
    folderId,
    responseFormat: "FORMAT_XML",
  };

  const response = await fetch("https://searchapi.api.cloud.yandex.net/v2/web/search", {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Yandex Search API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as { rawData: string };
  const xml = Buffer.from(json.rawData, "base64").toString("utf8");

  const parsed = parser.parse(xml) as {
    yandexsearch?: {
      response?: {
        results?: {
          grouping?: {
            group?: Array<{ doc?: unknown }>;
          };
        };
      };
    };
  };

  const groups: Array<{ doc?: unknown }> =
    parsed?.yandexsearch?.response?.results?.grouping?.group ?? [];

  const documents = groups.flatMap((g) => {
    const doc = g.doc as Record<string, unknown> | undefined;
    if (!doc) return [];
    const rawPassages =
      (doc.passages as Record<string, unknown> | undefined)?.passage ?? [];
    const passages = (Array.isArray(rawPassages) ? rawPassages : [rawPassages]).map((p) =>
      stripHlword(String(p ?? ""))
    );
    return [
      {
        url: String(doc.url ?? ""),
        domain: String(doc.domain ?? ""),
        title: stripHlword(String(doc.title ?? "")),
        modtime: doc.modtime ? String(doc.modtime) : null,
        passages,
      },
    ];
  });

  return SearchResultSchema.parse({ query: input.query, page, documents });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  query: z.string().max(400).describe("Search query text (max 400 chars)"),
  page: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("0-based result page number (default: 0)"),
});

class WebSearchTool extends AgentTool<typeof inputSchema> {
  readonly name = "web_search";
  readonly description =
    "Search the Russian web index (Yandex). Returns top documents with title, URL and text snippets. Use for current events, Russian-language content, or any factual look-up.";
  readonly inputSchema = inputSchema;
  readonly outputSchema = SearchResultSchema;
  // durable: true (default) — the HTTP call runs inside a checkpointed ctx.run step.
  // mutating: false — read-only, no idempotency key needed.

  async execute({ input }: { ctx: ObjectContext; input: z.infer<typeof inputSchema> }): Promise<unknown> {
    return searchWeb(input);
  }
}

export const webSearchTool = new WebSearchTool();
