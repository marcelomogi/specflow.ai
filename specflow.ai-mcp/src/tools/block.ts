import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { generateEmbedding } from "../lib/embeddings.js";
import { McpError } from "../lib/errors.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const BlockCreateSchema = z.object({
  document_id: z.string().uuid(),
  content: z.string().min(1),
  rationale: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
});

export const BlockUpdateSchema = z.object({
  block_id: z.string().uuid(),
  content: z.string().min(1),
  rationale: z.string(),
  change_source: z.enum(["human", "agent", "mcp"]).default("agent"),
});

export const BlockFreezeSchema = z.object({
  block_id: z.string().uuid(),
  frozen: z.boolean(),
  owner_id: z.string().uuid(),
});

export const BlockGetHistorySchema = z.object({
  block_id: z.string().uuid(),
});

export const BlockReorderSchema = z.object({
  document_id: z.string().uuid(),
  block_order: z.array(z.string().uuid()).min(1),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function blockCreate(input: z.infer<typeof BlockCreateSchema>) {
  const sb = getSupabase();
  const embedding = await generateEmbedding(input.content);

  const { data: block, error: blockErr } = await sb
    .from("block")
    .insert({
      document_id: input.document_id,
      content: input.content,
      rationale: input.rationale ?? null,
      status: "draft",
      version: 1,
      embedding: JSON.stringify(embedding),
    })
    .select("block_id, status, version")
    .single();

  if (blockErr || !block) {
    throw new McpError(blockErr?.message ?? "Failed to create block", "DB_ERROR");
  }

  // Update block_order on the document
  const { data: doc, error: docErr } = await sb
    .from("document")
    .select("block_order")
    .eq("document_id", input.document_id)
    .single();

  if (docErr || !doc) {
    throw new McpError(
      `Document ${input.document_id} not found`,
      "NOT_FOUND"
    );
  }

  const currentOrder: string[] = doc.block_order ?? [];
  let newOrder: string[];

  if (input.position !== undefined && input.position <= currentOrder.length) {
    newOrder = [
      ...currentOrder.slice(0, input.position),
      block.block_id as string,
      ...currentOrder.slice(input.position),
    ];
  } else {
    newOrder = [...currentOrder, block.block_id as string];
  }

  const { error: orderErr } = await sb
    .from("document")
    .update({ block_order: newOrder })
    .eq("document_id", input.document_id);

  if (orderErr) throw new McpError(orderErr.message, "DB_ERROR");

  return block;
}

export async function blockUpdate(input: z.infer<typeof BlockUpdateSchema>) {
  const sb = getSupabase();

  const { data: existing, error: fetchErr } = await sb
    .from("block")
    .select("status, version")
    .eq("block_id", input.block_id)
    .single();

  if (fetchErr || !existing) {
    throw new McpError(`Block ${input.block_id} not found`, "NOT_FOUND");
  }

  if ((existing.status as string) === "frozen") {
    throw new McpError(
      `Block ${input.block_id} is frozen and cannot be edited. Unfreeze it first.`,
      "FROZEN"
    );
  }

  const embedding = await generateEmbedding(input.content);

  const { data, error } = await sb
    .from("block")
    .update({
      content: input.content,
      rationale: input.rationale,
      embedding: JSON.stringify(embedding),
      updated_at: new Date().toISOString(),
    })
    .eq("block_id", input.block_id)
    .select("block_id, version, updated_at")
    .single();

  if (error) throw new McpError(error.message, "DB_ERROR");

  return data;
}

export async function blockFreeze(input: z.infer<typeof BlockFreezeSchema>) {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("block")
    .update({
      status: input.frozen ? "frozen" : "draft",
      frozen_by: input.frozen ? input.owner_id : null,
    })
    .eq("block_id", input.block_id)
    .select("block_id, status")
    .single();

  if (error) throw new McpError(error.message, "DB_ERROR");
  if (!data) throw new McpError(`Block ${input.block_id} not found`, "NOT_FOUND");

  return data;
}

export async function blockGetHistory(
  input: z.infer<typeof BlockGetHistorySchema>
) {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("block_version")
    .select("version_id, block_id, content, rationale, changed_by, change_source, version_number, created_at")
    .eq("block_id", input.block_id)
    .order("version_number", { ascending: false });

  if (error) throw new McpError(error.message, "DB_ERROR");

  return data ?? [];
}

export async function blockReorder(input: z.infer<typeof BlockReorderSchema>) {
  const sb = getSupabase();

  // Validate all block_ids belong to this document
  const { data: blocks, error: fetchErr } = await sb
    .from("block")
    .select("block_id")
    .eq("document_id", input.document_id)
    .in("block_id", input.block_order);

  if (fetchErr) throw new McpError(fetchErr.message, "DB_ERROR");

  const found = new Set((blocks ?? []).map((b) => b.block_id as string));
  const invalid = input.block_order.filter((id) => !found.has(id));

  if (invalid.length > 0) {
    throw new McpError(
      `The following block_ids do not belong to document ${input.document_id}: ${invalid.join(", ")}`,
      "VALIDATION_ERROR"
    );
  }

  const { error } = await sb
    .from("document")
    .update({ block_order: input.block_order })
    .eq("document_id", input.document_id);

  if (error) throw new McpError(error.message, "DB_ERROR");

  return { document_id: input.document_id, block_order: input.block_order };
}
