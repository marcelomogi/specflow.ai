import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { generateEmbedding } from "../lib/embeddings.js";
import { callLLM } from "../lib/llm.js";
import { McpError } from "../lib/errors.js";
import { franc } from 'franc'


// ─── Schemas ──────────────────────────────────────────────────────────────────

export const DocumentCreateSchema = z.object({
  title: z.string().min(1),
  doc_type: z.enum(["prd", "policy", "contract", "runbook"]),
  owner_id: z.string().uuid(),
  rationale: z.string().optional(),
});

export const DocumentGetSchema = z.object({
  document_id: z.string().uuid(),
});

export const DocumentPublishSchema = z.object({
  document_id: z.string().uuid(),
  owner_id: z.string().uuid(),
});

export const DocumentImportSchema = z.object({
  title: z.string().min(1),
  doc_type: z.enum(["prd", "policy", "contract", "runbook"]),
  owner_id: z.string().uuid(),
  content: z.string().min(1),
});

export const DocumentUpdateRationaleSchema = z.object({
  document_id: z.string().uuid(),
  rationale: z.string().min(1),
});

export const DocumentIngestSchema = z.object({
  document_id: z.string().uuid(),
  raw_text: z.string().min(1),
  origin: z.enum(["oficial", "rascunho", "legado"]).default("rascunho"),
});

export const DocumentDeleteSchema = z.object({
  document_id: z.string().uuid(),
});

export const ImproveRationaleSchema = z.object({
  document_id: z.string().uuid(),
});

export const DocumentListSchema = z.object({
  doc_type: z.enum(["prd", "policy", "contract", "runbook"]).optional(),
  status: z.enum(["draft", "approved"]).optional(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function documentList(
  input: z.infer<typeof DocumentListSchema>
) {
  const sb = getSupabase();

  let query = sb
    .from("document")
    .select("document_id, title, doc_type, status, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (input.doc_type) {
    query = query.eq("doc_type", input.doc_type);
  }

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query;

  if (error) throw new McpError(error.message, "DB_ERROR");

  return data ?? [];
}

export async function documentCreate(
  input: z.infer<typeof DocumentCreateSchema>
) {
  const sb = getSupabase();
  const embedding = await generateEmbedding(input.title);

  const { data, error } = await sb
    .from("document")
    .insert({
      title: input.title,
      doc_type: input.doc_type,
      owner_id: input.owner_id,
      rationale: input.rationale ?? null,
      status: "draft",
      block_order: [],
      embedding: JSON.stringify(embedding),
    })
    .select("document_id, title, status, rationale, created_at")
    .single();

  if (error) throw new McpError(error.message, "DB_ERROR");

  return data;
}

export async function documentUpdateRationale(
  input: z.infer<typeof DocumentUpdateRationaleSchema>
) {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("document")
    .update({
      rationale: input.rationale,
      updated_at: new Date().toISOString(),
    })
    .eq("document_id", input.document_id)
    .select("document_id, rationale, updated_at")
    .single();

  if (error) throw new McpError(error.message, "DB_ERROR");
  if (!data) {
    throw new McpError(
      `Document ${input.document_id} not found`,
      "NOT_FOUND"
    );
  }

  return data;
}

export async function documentIngest(
  input: z.infer<typeof DocumentIngestSchema>
) {
  const sb = getSupabase();

  // 1. Verify document exists
  const { data: doc, error: docErr } = await sb
    .from("document")
    .select("document_id, block_order")
    .eq("document_id", input.document_id)
    .single();

  if (docErr || !doc) {
    throw new McpError(
      `Document ${input.document_id} not found`,
      "NOT_FOUND"
    );
  }

  // 2. Chunk the raw text semantically via LLM
  const chunks = await chunkTextWithLLM(input.raw_text);
  if (chunks.length === 0) {
    throw new McpError(
      "O LLM não retornou nenhum chunk — verifique se o texto tem conteúdo semântico",
      "CHUNKING_ERROR"
    );
  }

  // 3. Bulk-insert blocks with embeddings (parallelise embedding calls)
  const blockInserts = await Promise.all(
    chunks.map(async (chunk, i) => ({
      document_id: input.document_id,
      content: chunk.content,
      status: "draft",
      version: 1,
      rationale: `Ingestão automática — bloco ${i + 1}/${chunks.length} (origem: ${input.origin})`,
      embedding: JSON.stringify(await generateEmbedding(chunk.content)),
    }))
  );

  const { data: blocks, error: blocksErr } = await sb
    .from("block")
    .insert(blockInserts)
    .select("block_id");

  if (blocksErr || !blocks) {
    throw new McpError(
      blocksErr?.message ?? "Failed to create blocks",
      "DB_ERROR"
    );
  }

  const newBlockIds = blocks.map((b) => b.block_id as string);
  const updatedOrder = [...(doc.block_order ?? []), ...newBlockIds];

  // 4. Persist updated block_order
  const { error: orderErr } = await sb
    .from("document")
    .update({ block_order: updatedOrder })
    .eq("document_id", input.document_id);

  if (orderErr) throw new McpError(orderErr.message, "DB_ERROR");

  return {
    document_id: input.document_id,
    blocks_created: newBlockIds.length,
    block_ids: newBlockIds,
    origin: input.origin,
  };
}

export async function documentDelete(
  input: z.infer<typeof DocumentDeleteSchema>
) {
  const sb = getSupabase();

  const { error } = await sb
    .from("document")
    .delete()
    .eq("document_id", input.document_id);

  if (error) throw new McpError(error.message, "DB_ERROR");

  return { deleted: true, document_id: input.document_id };
}

export async function improveRationale(
  input: z.infer<typeof ImproveRationaleSchema>
) {
  const sb = getSupabase();

  // 1. Fetch document
  const { data: doc, error: docErr } = await sb
    .from("document")
    .select("title, doc_type, rationale, block_order")
    .eq("document_id", input.document_id)
    .single();

  if (docErr || !doc) {
    throw new McpError(
      `Document ${input.document_id} not found`,
      "NOT_FOUND"
    );
  }

  const blockOrder: string[] = doc.block_order ?? [];

  if (blockOrder.length === 0) {
    throw new McpError(
      "Adicione alguns blocos antes de melhorar o rationale.",
      "VALIDATION_ERROR"
    );
  }

  // 2. Fetch block contents
  const { data: blocks, error: blocksErr } = await sb
    .from("block")
    .select("content")
    .in("block_id", blockOrder)
    .neq("content", "");

  if (blocksErr) throw new McpError(blocksErr.message, "DB_ERROR");

  const blockContents = (blocks ?? [])
    .map((b) => b.content as string)
    .filter((c) => c.trim().length > 0);

  if (blockContents.length === 0) {
    throw new McpError(
      "Adicione alguns blocos antes de melhorar o rationale.",
      "VALIDATION_ERROR"
    );
  }

  // 3. Call LLM via OpenRouter
  const systemPrompt =
    `You are a product documentation assistant.
    Write or improve the rationale of a document based on its actual content.
    Be direct and objective.
    Reply only with the rationale text, no preamble.
    Generate the rationale based on the block content, not just the title or document type.
    Always respond in the same language as the block content.`.trim();

// Detectar língua pelo primeiro bloco
const langHint = franc(blockContents.join(' '))


console.log(`LLM rationale improvement - detected language: ${langHint}`);

const userContent = 
  `Document: ${doc.title} (${doc.doc_type})
  Current rationale: ${(doc.rationale as string | null)?.trim() || 'not filled'}

  Block content:
  ${blockContents.join("\n\n")}

  Write a clear rationale explaining why this document exists and what problem it solves.
  IMPORTANT: you MUST respond in the language with ISO 639-3 code: ${langHint}`.trim();
  
  const rationale = await callLLM(systemPrompt, userContent);

  if (!rationale.trim()) {
    throw new McpError("O modelo não retornou texto.", "LLM_ERROR");
  }

  return { rationale: rationale.trim() };
}

// ─── LLM chunking helper ──────────────────────────────────────────────────────

const CHUNKING_SYSTEM_PROMPT = `
You are a corporate document analyzer.

Your job is to identify the semantic boundaries of the text below and
return a list of chunks. Each chunk must contain a single autonomous rule,
decision or policy.

Rules:
- NEVER alter the content. Copy the text exactly as it appears.
- NEVER translate. If the source is in English, keep it in English. If in Portuguese, keep it in Portuguese.
- Separate by meaning, not by size.
- Change block when: the subject, condition, or temporal context changes.
- Return ONLY valid JSON, no markdown, no preamble.
- Keep items like lists, tables or related sections in the same block, unless there is a clear change in meaning.

Output format:
[
  { "content": "exact text of chunk 1" },
  { "content": "exact text of chunk 2" }
]`;

async function chunkTextWithLLM(
  rawText: string
): Promise<{ content: string }[]> {
  const raw = await callLLM(CHUNKING_SYSTEM_PROMPT, rawText);

  // Strip markdown code fences the model might add despite the instruction
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new McpError(
      `O LLM retornou JSON inválido: ${cleaned.slice(0, 200)}`,
      "CHUNKING_ERROR"
    );
  }

  // Accept both bare array and { chunks: [...] } wrapper
  const array: unknown[] = Array.isArray(parsed)
    ? parsed
    : (parsed as { chunks?: unknown[] }).chunks ?? [];

  return array.filter(
    (c): c is { content: string } =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as { content?: unknown }).content === "string" &&
      ((c as { content: string }).content.trim().length > 0)
  );
}

// ─── Original handlers (unchanged) ───────────────────────────────────────────

export async function documentGet(input: z.infer<typeof DocumentGetSchema>) {
  const sb = getSupabase();

  const { data: doc, error: docErr } = await sb
    .from("document")
    .select("*")
    .eq("document_id", input.document_id)
    .single();

  if (docErr || !doc) {
    throw new McpError(
      `Document ${input.document_id} not found`,
      "NOT_FOUND"
    );
  }

  // Fetch blocks in block_order
  const blockOrder: string[] = doc.block_order ?? [];
  let blocks: unknown[] = [];

  if (blockOrder.length > 0) {
    const { data: rawBlocks, error: blocksErr } = await sb
      .from("block")
      .select(
        "block_id, document_id, content, status, rationale, frozen_by, version, created_at, updated_at"
      )
      .in("block_id", blockOrder);

    if (blocksErr) throw new McpError(blocksErr.message, "DB_ERROR");

    const blockMap = new Map(
      (rawBlocks ?? []).map((b) => [b.block_id as string, b as unknown])
    );
    blocks = blockOrder
      .map((id) => blockMap.get(id))
      .filter((b): b is NonNullable<typeof b> => b !== undefined);
  }

  // Fetch relations for this document's blocks
  let relations: unknown[] = [];
  if (blockOrder.length > 0) {
    const { data: rel } = await sb
      .from("block_relation")
      .select("*")
      .in("source_block_id", blockOrder);
    relations = rel ?? [];
  }

  return { ...doc, blocks, relations };
}

export async function documentPublish(
  input: z.infer<typeof DocumentPublishSchema>
) {
  const sb = getSupabase();

  const { data: doc, error: docErr } = await sb
    .from("document")
    .select("document_id, block_order, owner_id")
    .eq("document_id", input.document_id)
    .single();

  if (docErr || !doc) {
    throw new McpError(
      `Document ${input.document_id} not found`,
      "NOT_FOUND"
    );
  }

  if ((doc.owner_id as string) !== input.owner_id) {
    throw new McpError(
      "Only the document owner can publish it",
      "FORBIDDEN"
    );
  }

  const blockOrder: string[] = doc.block_order ?? [];

  if (blockOrder.length > 0) {
    const { data: conflictBlocks } = await sb
      .from("block")
      .select("block_id")
      .in("block_id", blockOrder)
      .eq("status", "conflict");

    if (conflictBlocks && conflictBlocks.length > 0) {
      const ids = conflictBlocks.map((b) => b.block_id).join(", ");
      throw new McpError(
        `Cannot publish: the following blocks have unresolved conflicts — ${ids}`,
        "CONFLICT"
      );
    }
  }

  const { data, error } = await sb
    .from("document")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("document_id", input.document_id)
    .select("document_id, status, approved_at")
    .single();

  if (error) throw new McpError(error.message, "DB_ERROR");

  return data;
}

export async function documentImport(
  input: z.infer<typeof DocumentImportSchema>
) {
  const sb = getSupabase();

  // Segment content into blocks
  const segments = input.content
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50);

  if (segments.length === 0) {
    throw new McpError(
      "Content could not be segmented into blocks — ensure paragraphs are separated by blank lines and each has at least 50 characters",
      "VALIDATION_ERROR"
    );
  }

  // Create the document first
  const docEmbedding = await generateEmbedding(input.title);

  const { data: doc, error: docErr } = await sb
    .from("document")
    .insert({
      title: input.title,
      doc_type: input.doc_type,
      owner_id: input.owner_id,
      status: "draft",
      block_order: [],
      embedding: JSON.stringify(docEmbedding),
    })
    .select("document_id")
    .single();

  if (docErr || !doc) {
    throw new McpError(docErr?.message ?? "Failed to create document", "DB_ERROR");
  }

  // Create blocks with embeddings
  const blockInserts = await Promise.all(
    segments.map(async (content) => ({
      document_id: doc.document_id as string,
      content,
      status: "draft",
      version: 1,
      embedding: JSON.stringify(await generateEmbedding(content)),
    }))
  );

  const { data: blocks, error: blocksErr } = await sb
    .from("block")
    .insert(blockInserts)
    .select("block_id");

  if (blocksErr || !blocks) {
    throw new McpError(blocksErr?.message ?? "Failed to create blocks", "DB_ERROR");
  }

  const blockOrder = blocks.map((b) => b.block_id as string);

  const { error: orderErr } = await sb
    .from("document")
    .update({ block_order: blockOrder })
    .eq("document_id", doc.document_id);

  if (orderErr) throw new McpError(orderErr.message, "DB_ERROR");

  return {
    document_id: doc.document_id,
    block_ids: blockOrder,
    blocks_created: blockOrder.length,
  };
}
