import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { generateEmbedding } from "../lib/embeddings.js";
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

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function relationDetect(
  input: z.infer<typeof RelationDetectSchema>
) {
  const sb = getSupabase();

  // Fetch the source block embedding
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

  // Vector similarity search via RPC (match_blocks function expected in Supabase)
  const { data: similar, error: searchErr } = await sb.rpc("match_blocks", {
    query_embedding: sourceBlock.embedding,
    match_threshold: input.threshold,
    match_count: 20,
    exclude_block_id: input.block_id,
  });

  if (searchErr) throw new McpError(searchErr.message, "DB_ERROR");

  const results = (similar ?? []).map(
    (row: {
      block_id: string;
      document_title: string;
      content: string;
      block_status: string;
      similarity: number;
    }) => ({
      block_id: row.block_id,
      document_title: row.document_title,
      content_excerpt: row.content.slice(0, 200),
      block_status: row.block_status,
      similarity_score: row.similarity,
      suggested_relation_type: row.similarity > 0.95 ? "similar" : "evolves_from",
    })
  );

  return results;
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
