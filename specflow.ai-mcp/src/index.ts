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
    "Create a new document in draft status",
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
    "Retrieve a document with its ordered blocks and relations",
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
    "Publish a document (status → approved). Fails if any block has unresolved conflicts.",
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
    "Import raw text content as a new document, auto-segmenting it into blocks",
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
    "Update the rationale (motivation/context) of an existing document",
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
    "Semantically chunk raw text into blocks using an LLM and persist them as draft blocks in an existing document. Never alters the original content.",
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
    "Permanently delete a document and all its blocks (cascade). Requires explicit PM confirmation before calling.",
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
    "List all documents ordered by most recently updated. Optionally filter by doc_type and/or status. Returns metadata only — no block content.",
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
    "Generate or improve the rationale of a document by analysing its blocks with an LLM. Returns the suggested text — does not save it; the PM reviews and confirms.",
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
    "Add a new block to a document at an optional position",
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
    "Update a block's content and rationale. Fails if the block is frozen.",
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
    "Freeze or unfreeze a block to protect it from edits",
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
    "Retrieve the full version history of a block",
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
    "Update the block ordering of a document",
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
    "Find semantically similar blocks in approved documents using vector search",
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
    "Register a relation between two blocks. Use relation_type='conflict' to flag a conflict.",
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
    "Semantic search over approved documents in the knowledge base",
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
