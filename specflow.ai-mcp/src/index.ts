import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Lib
import { toErrorContent } from "./lib/errors.js";
import { agentPromptHandler } from "./routes/agentPrompt.js";

// Tool schemas & handlers
import {
  DocumentCreateSchema,
  DocumentGetSchema,
  DocumentPublishSchema,
  DocumentImportSchema,
  DocumentUpdateRationaleSchema,
  DocumentIngestSchema,
  DocumentDeleteSchema,
  ImproveRationaleSchema,
  DocumentListSchema,
  documentCreate,
  documentGet,
  documentPublish,
  documentImport,
  documentUpdateRationale,
  documentIngest,
  documentDelete,
  improveRationale,
  documentList,
} from "./tools/document.js";

import {
  BlockCreateSchema,
  BlockUpdateSchema,
  BlockFreezeSchema,
  BlockGetHistorySchema,
  BlockReorderSchema,
  blockCreate,
  blockUpdate,
  blockFreeze,
  blockGetHistory,
  blockReorder,
} from "./tools/block.js";

import {
  RelationDetectSchema,
  RelationRegisterSchema,
  KbSearchSchema,
  relationDetect,
  relationRegister,
  kbSearch,
} from "./tools/knowledge.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tool: string, params: unknown) {
  process.stderr.write(
    `[specflowia-mcp] ${tool} ${JSON.stringify(params)}\n`
  );
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(e: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${toErrorContent(e)}` }],
    isError: true,
  };
}

// ─── Server factory ───────────────────────────────────────────────────────────
// Returns a fresh McpServer with all tools registered.
// Called once for stdio and once per HTTP request, so each transport gets
// its own isolated server instance (avoids "Already connected" errors).

function createServer(): McpServer {
  const server = new McpServer({
    name: "specflowia-mcp",
    version: "0.1.0",
  });

  // ── Document tools ──────────────────────────────────────────────────────

  server.tool(
    "document_create",
    "[specflowia] Create a new specflowia document in draft status. Use when the PM wants to start authoring a new PRD, policy, contract, or runbook from scratch. Requires title, doc_type, and owner_id.",
    DocumentCreateSchema.shape,
    async (params) => {
      log("document_create", params);
      try {
        return ok(await documentCreate(params as Parameters<typeof documentCreate>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "document_get",
    "[specflowia] Retrieve a specflowia document by ID, including its ordered blocks and relations. Use before editing, reviewing, or continuing work on an existing document.",
    DocumentGetSchema.shape,
    async (params) => {
      log("document_get", params);
      try {
        return ok(await documentGet(params as Parameters<typeof documentGet>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "document_publish",
    "[specflowia] Publish a specflowia document, changing its status from draft to approved. Fails if any block has unresolved conflicts. Use only when the PM explicitly confirms the document is ready to publish.",
    DocumentPublishSchema.shape,
    async (params) => {
      log("document_publish", params);
      try {
        return ok(await documentPublish(params as Parameters<typeof documentPublish>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "document_import",
    "[specflowia] Create a new specflowia document and auto-segment its content into blocks in a single call. Use when the PM provides existing raw text (from a file, paste, or extraction) and there is no document yet. Prefer over document_create + document_ingest when starting from scratch with existing content.",
    DocumentImportSchema.shape,
    async (params) => {
      log("document_import", params);
      try {
        return ok(await documentImport(params as Parameters<typeof documentImport>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "document_update_rationale",
    "[specflowia] Update the motivation and context (rationale) of an existing specflowia document. Use after improve_rationale returns a suggestion and the PM confirms, or when the PM wants to manually revise the document rationale.",
    DocumentUpdateRationaleSchema.shape,
    async (params) => {
      log("document_update_rationale", params);
      try {
        return ok(await documentUpdateRationale(params as Parameters<typeof documentUpdateRationale>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "document_ingest",
    "[specflowia] Add raw text to an existing specflowia document by semantically chunking it into draft blocks. Use when the document already exists and the PM wants to append or import additional content into it.",
    DocumentIngestSchema.shape,
    async (params) => {
      log("document_ingest", params);
      try {
        return ok(await documentIngest(params as Parameters<typeof documentIngest>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "document_delete",
    "[specflowia] Permanently delete a specflowia document and all its blocks (cascade). This action is irreversible. Always ask for explicit PM confirmation before calling. Never call speculatively.",
    DocumentDeleteSchema.shape,
    async (params) => {
      log("document_delete", params);
      try {
        return ok(await documentDelete(params as Parameters<typeof documentDelete>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "document_list",
    "[specflowia] List all specflowia documents ordered by most recently updated. Use at the start of every session to show the PM what documents exist, and after any document_create or document_import to refresh the list. Optionally filter by doc_type or status.",
    DocumentListSchema.shape,
    async (params) => {
      log("document_list", params);
      try {
        return ok(await documentList(params as Parameters<typeof documentList>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "improve_rationale",
    "[specflowia] Analyse the blocks of a specflowia document with an LLM and generate or improve its rationale text. Returns a suggestion only — does not save. After the PM reviews and confirms, persist the result using document_update_rationale.",
    ImproveRationaleSchema.shape,
    async (params) => {
      log("improve_rationale", params);
      try {
        return ok(await improveRationale(params as Parameters<typeof improveRationale>[0]));
      } catch (e) { return err(e); }
    }
  );

  // ── Block tools ─────────────────────────────────────────────────────────

  server.tool(
    "block_create",
    "[specflowia] Add a new content block to a specflowia document at an optional position. Use when the PM approves new content to be persisted. All document content must go through this tool — never output content as free text in chat.",
    BlockCreateSchema.shape,
    async (params) => {
      log("block_create", params);
      try {
        return ok(await blockCreate(params as Parameters<typeof blockCreate>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "block_update",
    "[specflowia] Update the content and rationale of an existing specflowia block. Fails if the block is frozen. Use when the PM approves an edit to an existing block.",
    BlockUpdateSchema.shape,
    async (params) => {
      log("block_update", params);
      try {
        return ok(await blockUpdate(params as Parameters<typeof blockUpdate>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "block_freeze",
    "[specflowia] Freeze or unfreeze a specflowia block to protect it from further edits. Frozen blocks cannot be updated. Use when the PM wants to lock approved content.",
    BlockFreezeSchema.shape,
    async (params) => {
      log("block_freeze", params);
      try {
        return ok(await blockFreeze(params as Parameters<typeof blockFreeze>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "block_get_history",
    "[specflowia] Retrieve the full version history of a specflowia block, including all past content and rationale changes. Use when the PM wants to audit changes or revert to a previous version.",
    BlockGetHistorySchema.shape,
    async (params) => {
      log("block_get_history", params);
      try {
        return ok(await blockGetHistory(params as Parameters<typeof blockGetHistory>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "block_reorder",
    "[specflowia] Change the order of blocks in a specflowia document by providing the full ordered list of block UUIDs. Use when the PM wants to restructure the document flow.",
    BlockReorderSchema.shape,
    async (params) => {
      log("block_reorder", params);
      try {
        return ok(await blockReorder(params as Parameters<typeof blockReorder>[0]));
      } catch (e) { return err(e); }
    }
  );

  // ── Knowledge / relation tools ──────────────────────────────────────────

  server.tool(
    "relation_detect",
    "[specflowia] Find specflowia blocks semantically similar to a given block using vector search across approved documents. Use to surface potential conflicts, dependencies, or related content before creating or updating a block.",
    RelationDetectSchema.shape,
    async (params) => {
      log("relation_detect", params);
      try {
        return ok(await relationDetect(params as Parameters<typeof relationDetect>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "relation_register",
    "[specflowia] Register a typed relation between two specflowia blocks. Relation types: conflict, depends_on, evolves_from, similar. Use after relation_detect surfaces a meaningful connection, or when the PM explicitly identifies a relationship between blocks.",
    RelationRegisterSchema.shape,
    async (params) => {
      log("relation_register", params);
      try {
        return ok(await relationRegister(params as Parameters<typeof relationRegister>[0]));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    "kb_search",
    "[specflowia] Semantic search over all approved specflowia documents in the knowledge base. Use when the PM wants to find existing content by topic, keyword, or theme before creating new documents or blocks.",
    KbSearchSchema.shape,
    async (params) => {
      log("kb_search", params);
      try {
        return ok(await kbSearch(params as Parameters<typeof kbSearch>[0]));
      } catch (e) { return err(e); }
    }
  );

  return server;
}

// ─── HTTP transport (port 3001) ───────────────────────────────────────────────

const HTTP_PORT = Number(process.env.PORT ?? process.env.MCP_HTTP_PORT ?? 3001);

const app = express();

app.use(
  cors({
    origin: process.env.MCP_CORS_ORIGIN ? process.env.MCP_CORS_ORIGIN.split(',') : true,
    methods: ["POST", "GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id"],
    exposedHeaders: ["Mcp-Session-Id"],
  })
);

app.use(express.json());

// ─── Agent prompt endpoint ────────────────────────────────────────────────────
// GET /agent/prompt?mode=coauthor|ingest
// Returns the system prompt + context for the requested agent mode.
// The Claude.ai skill calls this on startup — prompts live here, not in the skill.
app.get("/agent/prompt", agentPromptHandler);

// New server + transport instance per request — avoids "Already connected" error.
app.post("/mcp", async (req, res) => {
  process.stderr.write(`[specflowia-mcp] HTTP POST /mcp\n`);
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    process.stderr.write(`[specflowia-mcp] HTTP error: ${e}\n`);
    if (!res.headersSent) {
      res.status(500).json({ error: String(e) });
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  // stdio — Claude Desktop / Claude.ai (dedicated instance)
  const stdioServer = createServer();
  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);
  process.stderr.write("[specflowia-mcp] stdio transport ready\n");

  // HTTP — editor web
  app.listen(HTTP_PORT, () => {
    process.stderr.write(
      `[specflowia-mcp] HTTP transport listening on port ${HTTP_PORT}\n`
    );
  });
}

main().catch((e) => {
  process.stderr.write(`[specflowia-mcp] Fatal: ${e}\n`);
  process.exit(1);
});
