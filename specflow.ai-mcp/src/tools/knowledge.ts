import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { generateEmbedding } from "../lib/embeddings.js";
import { callLLM } from "../lib/llm.js";
import { McpError } from "../lib/errors.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const RelationDetectSchema = z.object({
  block_id: z.string().uuid(),
  relation_types: z
    .array(z.enum(["conflict", "depends_on", "evolves_from", "similar"]))
    .optional(),
  threshold: z.number().min(0).max(1).default(0.7),
});

export const RelationRegisterSchema = z.object({
  source_block_id: z.string().uuid(),
  target_block_id: z.string().uuid(),
  relation_type: z.enum(["conflict", "depends_on", "evolves_from", "similar"]),
  origin: z.enum(["structural", "inferred"]),
  description: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

export const KbSearchSchema = z.object({
  query: z.string().min(1),
  doc_types: z
    .array(z.enum(["prd", "policy", "contract", "runbook"]))
    .optional(),
  limit: z.number().int().positive().default(10),
});

// ─── Private types ────────────────────────────────────────────────────────────

type RelationTypeWithNone =
  | "conflict"
  | "depends_on"
  | "evolves_from"
  | "similar"
  | "none";

interface LLMClassification {
  block_id: string;
  relation_type: RelationTypeWithNone;
  confidence: number;
  explanation: string;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Expand a set of candidate block IDs by one hop in the relation graph.
 * Only follows conflict / depends_on / evolves_from edges (bidirectionally).
 * depth is accepted for future use but currently only depth=1 is executed.
 */
async function graphExpand(
  candidateIds: string[],
  excludeBlockId: string,
  depth: number = 1
): Promise<string[]> {
  if (candidateIds.length === 0 || depth === 0) return candidateIds;

  const sb = getSupabase();
  const expandTypes = ["conflict", "depends_on", "evolves_from"];

  // Bidirectional: fetch edges where candidates appear as source OR target
  const [{ data: asSource }, { data: asTarget }] = await Promise.all([
    sb
      .from("block_relation")
      .select("source_block_id, target_block_id")
      .in("relation_type", expandTypes)
      .in("source_block_id", candidateIds),
    sb
      .from("block_relation")
      .select("source_block_id, target_block_id")
      .in("relation_type", expandTypes)
      .in("target_block_id", candidateIds),
  ]);

  const expanded = new Set<string>(candidateIds);

  for (const rel of [...(asSource ?? []), ...(asTarget ?? [])]) {
    const src = rel.source_block_id as string;
    const tgt = rel.target_block_id as string;
    if (src !== excludeBlockId) expanded.add(src);
    if (tgt !== excludeBlockId) expanded.add(tgt);
  }

  return Array.from(expanded);
}

/**
 * Remove candidate IDs that the author has already explicitly rejected
 * for the given source block.
 */
async function filterRejections(
  sourceBlockId: string,
  candidateIds: string[]
): Promise<string[]> {
  if (candidateIds.length === 0) return [];

  const sb = getSupabase();

  const { data: rejections } = await sb
    .from("relation_rejection")
    .select("target_block_id")
    .eq("source_block_id", sourceBlockId)
    .in("target_block_id", candidateIds);

  const rejectedSet = new Set(
    (rejections ?? []).map((r) => r.target_block_id as string)
  );

  return candidateIds.filter((id) => !rejectedSet.has(id));
}

// ─── LLM classification ────────────────────────────────────────────────────────

const CLASSIFY_SYSTEM_PROMPT = `
You are a document knowledge graph analyst.
Your task is to classify the semantic relationship between a source block and a list of candidate blocks.

Relation type definitions:
- conflict     : the source and candidate make contradictory claims about the same subject (e.g. opposing rules, incompatible policies, contradictory decisions).
- depends_on   : the source block implicitly assumes the candidate is true or in effect. If the candidate changes, the source may break or become invalid.
- evolves_from : the source block is a newer, revised, or expanded version of the candidate. The candidate was the prior rule or decision.
- similar      : both blocks cover the same topic without contradiction, dependency, or evolutionary relationship. They coexist without conflict.
- none         : no meaningful relationship. The blocks are unrelated or only superficially similar.

Rules:
- Be conservative. Only classify when there is clear textual evidence.
- Each candidate receives exactly one classification.
- Return ONLY valid JSON — no markdown, no preamble, no trailing text.

Output format (one entry per candidate, in the same order):
[
  {
    "block_id": "uuid",
    "relation_type": "conflict | depends_on | evolves_from | similar | none",
    "confidence": 0.0,
    "explanation": "one sentence explaining the classification"
  }
]`.trim();

async function classifyRelations(
  sourceContent: string,
  candidates: Array<{ block_id: string; content: string }>
): Promise<LLMClassification[]> {
  const userContent = `Source block:
"""
${sourceContent}
"""

Candidate blocks:
${candidates
  .map((c) => `block_id: ${c.block_id}\n"""\n${c.content}\n"""`)
  .join("\n\n")}

Classify the relation from the source block to each candidate.`;

  const raw = await callLLM(CLASSIFY_SYSTEM_PROMPT, userContent);

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new McpError(
      `LLM returned invalid JSON for relation classification: ${cleaned.slice(0, 200)}`,
      "LLM_ERROR"
    );
  }

  const array = Array.isArray(parsed) ? parsed : [];

  return array.filter(
    (item): item is LLMClassification =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).block_id === "string" &&
      typeof (item as Record<string, unknown>).relation_type === "string" &&
      typeof (item as Record<string, unknown>).confidence === "number" &&
      typeof (item as Record<string, unknown>).explanation === "string"
  );
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function relationDetect(
  input: z.infer<typeof RelationDetectSchema>
) {
  const sb = getSupabase();

  // 1. Fetch source block
  const { data: sourceBlock, error: blockErr } = await sb
    .from("block")
    .select("embedding, content")
    .eq("block_id", input.block_id)
    .single();

  if (blockErr || !sourceBlock) {
    throw new McpError(`Block ${input.block_id} not found`, "NOT_FOUND");
  }

  if (!sourceBlock.embedding) {
    throw new McpError(
      `Block ${input.block_id} has no embedding — update it first`,
      "NO_EMBEDDING"
    );
  }

  // 2. Vector search
  const { data: similar, error: searchErr } = await sb.rpc("match_blocks", {
    query_embedding: sourceBlock.embedding,
    match_threshold: input.threshold,
    match_count: 20,
    exclude_block_id: input.block_id,
  });

  if (searchErr) throw new McpError(searchErr.message, "DB_ERROR");

  type MatchRow = {
    block_id: string;
    document_title: string;
    content: string;
    block_status: string;
    similarity: number;
  };

  const vectorRows = (similar ?? []) as MatchRow[];
  const vectorIds = vectorRows.map((r) => r.block_id);
  const vectorSet = new Set(vectorIds);

  // Build lookup maps from vector results
  const similarityMap = new Map<string, number>();
  const documentTitleMap = new Map<string, string>();
  const contentMap = new Map<string, string>();
  const statusMap = new Map<string, string>();

  for (const row of vectorRows) {
    similarityMap.set(row.block_id, row.similarity);
    documentTitleMap.set(row.block_id, row.document_title);
    contentMap.set(row.block_id, row.content);
    statusMap.set(row.block_id, row.block_status);
  }

  // 3. Graph expand (depth=1 hardcoded)
  const expandedIds = await graphExpand(vectorIds, input.block_id);

  // 4. Filter already-rejected pairs
  const filteredIds = await filterRejections(input.block_id, expandedIds);

  if (filteredIds.length === 0) return [];

  // 5. Fetch content for graph-only candidates (vector candidates already cached)
  const graphOnlyIds = filteredIds.filter((id) => !vectorSet.has(id));

  if (graphOnlyIds.length > 0) {
    const { data: graphBlocks } = await sb
      .from("block")
      .select("block_id, content, status, document_id")
      .in("block_id", graphOnlyIds);

    if (graphBlocks && graphBlocks.length > 0) {
      const docIds = [...new Set(graphBlocks.map((b) => b.document_id as string))];

      const { data: docs } = await sb
        .from("document")
        .select("document_id, title")
        .in("document_id", docIds);

      const docTitleMap = new Map(
        (docs ?? []).map((d) => [d.document_id as string, d.title as string])
      );

      for (const b of graphBlocks) {
        contentMap.set(b.block_id as string, b.content as string);
        statusMap.set(b.block_id as string, b.status as string);
        documentTitleMap.set(
          b.block_id as string,
          docTitleMap.get(b.document_id as string) ?? "Documento desconhecido"
        );
      }
    }
  }

  // 6. Build candidate list for LLM (only IDs whose content was loaded)
  const candidatesForLLM = filteredIds
    .filter((id) => contentMap.has(id))
    .map((id) => ({ block_id: id, content: contentMap.get(id)! }));

  if (candidatesForLLM.length === 0) return [];

  // 7. LLM classification
  const classified = await classifyRelations(
    sourceBlock.content as string,
    candidatesForLLM
  );

  // 8. Apply optional relation_types post-filter from input
  const allowedTypes = input.relation_types
    ? new Set(input.relation_types)
    : null;

  // 9. Build final output — exclude "none", apply type filter
  return classified
    .filter(
      (r) =>
        r.relation_type !== "none" &&
        (allowedTypes === null || allowedTypes.has(r.relation_type as "conflict" | "depends_on" | "evolves_from" | "similar"))
    )
    .map((r) => ({
      block_id: r.block_id,
      document_title: documentTitleMap.get(r.block_id) ?? "Documento desconhecido",
      content_excerpt: (contentMap.get(r.block_id) ?? "").slice(0, 200),
      block_status: statusMap.get(r.block_id) ?? "unknown",
      similarity_score: similarityMap.get(r.block_id) ?? null,
      relation_type: r.relation_type,
      confidence: r.confidence,
      explanation: r.explanation,
      origin: "inferred" as const,
      source: vectorSet.has(r.block_id) ? ("vector" as const) : ("graph" as const),
    }));
}

export async function relationRegister(
  input: z.infer<typeof RelationRegisterSchema>
) {
  const sb = getSupabase();

  if (input.origin === "inferred" && input.confidence === undefined) {
    throw new McpError(
      "confidence is required when origin is 'inferred'",
      "VALIDATION_ERROR"
    );
  }

  const { data, error } = await sb
    .from("block_relation")
    .insert({
      source_block_id: input.source_block_id,
      target_block_id: input.target_block_id,
      relation_type: input.relation_type,
      origin: input.origin,
      description: input.description,
      confidence: input.confidence ?? null,
    })
    .select("relation_id, relation_type, origin")
    .single();

  if (error) throw new McpError(error.message, "DB_ERROR");

  // If conflict relation, mark source block as conflicted
  if (input.relation_type === "conflict") {
    const { error: updateErr } = await sb
      .from("block")
      .update({ status: "conflict" })
      .eq("block_id", input.source_block_id);

    if (updateErr) throw new McpError(updateErr.message, "DB_ERROR");
  }

  return data;
}

export async function kbSearch(input: z.infer<typeof KbSearchSchema>) {
  const sb = getSupabase();
  const embedding = await generateEmbedding(input.query);

  // Build the RPC call — match_blocks_approved filters by document.status = 'approved'
  const rpcParams: Record<string, unknown> = {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.0,
    match_count: input.limit,
  };

  if (input.doc_types && input.doc_types.length > 0) {
    rpcParams.filter_doc_types = input.doc_types;
  }

  const { data: results, error } = await sb.rpc(
    "match_approved_blocks",
    rpcParams
  );

  if (error) throw new McpError(error.message, "DB_ERROR");

  const blockIds = (results ?? []).map(
    (r: { block_id: string }) => r.block_id
  );

  // Fetch relations for the matched blocks
  let relationsMap: Map<string, unknown[]> = new Map();
  if (blockIds.length > 0) {
    const { data: relations } = await sb
      .from("block_relation")
      .select("*")
      .in("source_block_id", blockIds);

    for (const rel of relations ?? []) {
      const list = relationsMap.get(rel.source_block_id as string) ?? [];
      list.push(rel);
      relationsMap.set(rel.source_block_id as string, list);
    }
  }

  return (results ?? []).map(
    (row: {
      block_id: string;
      document_id: string;
      document_title: string;
      content: string;
      rationale: string | null;
      version: number;
      similarity: number;
    }) => ({
      block_id: row.block_id,
      document_id: row.document_id,
      document_title: row.document_title,
      content: row.content,
      rationale: row.rationale,
      version: row.version,
      similarity_score: row.similarity,
      relations: relationsMap.get(row.block_id) ?? [],
    })
  );
}
