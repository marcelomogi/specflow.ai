# SpecFlowIA

> Integrity layer for complex technical documents.

SpecFlowIA models a document as a dependency graph between content blocks and uses a consistency agent to automatically detect semantic contradictions between related sections when a decision changes.

---

## The problem

In long, collaborative technical documents, decisions change constantly. Traditional editors and wikis don't track the impact of those changes: editing one block can make another block inconsistent without anyone noticing.

SpecFlowIA detects this automatically.

---

## Who it's for

TPMs, platform teams, integration squads — any team that maintains technical documents with a high volume of interdependent decisions (PRDs, specs, policies, runbooks, contracts).

---

## Key features

| Feature | Description |
|---|---|
| **Block graph** | Each document is modelled as a graph of content blocks. Blocks declare relations (conflict, depends_on, evolves_from, similar). |
| **Conflict detection** | After every save, a vector similarity search detects semantically conflicting blocks across the knowledge base. |
| **Intent-aware versioning** | Every block version preserves a *rationale* — why the content changed — not just the content itself. |
| **Versioned knowledge base** | Approved documents feed a KB searchable by semantic similarity. Tracks the full evolution of decisions over time. |
| **Co-author agent** | Suggests block rationale automatically using LLM analysis of block content. Reduces dependency on user discipline. |
| **Ingest pipeline** | Upload a PDF, DOCX, or MD file. The agent reads it, chunks it into semantic blocks verbatim, and persists them as drafts. |
| **Conflict resolution UI** | When a conflict is detected, the PM chooses: "This is the new rule" (freeze + deprecate old), "Keep existing" (revert to draft), or "Resolve later". |

### Design boundary

> The system detects inconsistencies only within declared graph dependencies. Implicit dependencies are not covered. This is a scope boundary, not a bug.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Claude.ai / Claude Desktop        │
│              (skill: coauthor | ingest)              │
└────────────────────────┬────────────────────────────┘
                         │ MCP (HTTP + stdio)
┌────────────────────────▼────────────────────────────┐
│              MCP Server  (Node.js / TypeScript)      │
│   15 tools · Express :3001 · ngrok tunnel (HTTPS)   │
│                                                      │
│  document_*  block_*  relation_*  kb_search          │
│  improve_rationale  document_ingest  /agent/prompt   │
└────────────┬──────────────────────┬─────────────────┘
             │ Supabase JS          │ OpenRouter API
┌────────────▼──────────┐  ┌───────▼─────────────────┐
│  Supabase (Postgres   │  │  LLM + Embeddings        │
│  + pgvector)          │  │  text-embedding-3-small  │
│                       │  │  (configurable model)    │
│  document · block     │  └─────────────────────────┘
│  block_version        │
│  block_relation       │
└───────────────────────┘
         ▲
         │ Realtime (postgres_changes)
┌────────┴──────────────────────────────────────────┐
│              Web Editor  (Next.js 14)              │
│  TipTap blocks · conflict banners · version panel  │
│  Rationale AI · document import modal              │
└───────────────────────────────────────────────────┘
```

---

## Project structure

```
specflow.ai-mcp/
├── src/
│   ├── index.ts              # Entry point — Express + stdio transports
│   ├── lib/
│   │   ├── supabase.ts       # Supabase client (service role)
│   │   ├── embeddings.ts     # OpenRouter embedding calls
│   │   ├── llm.ts            # OpenRouter chat completions
│   │   └── errors.ts         # McpError class
│   ├── tools/
│   │   ├── document.ts       # document_* tools + improve_rationale
│   │   ├── block.ts          # block_* tools
│   │   └── knowledge.ts      # relation_detect, relation_register, kb_search
│   └── routes/
│       └── agentPrompt.ts    # GET /agent/prompt?mode=coauthor|ingest
├── editor/                   # Next.js 14 web editor
│   ├── app/
│   │   ├── page.tsx          # Document list
│   │   ├── documents/[id]/   # Document editor page
│   │   └── api/
│   │       ├── ingest/       # POST /api/ingest → document_ingest
│   │       └── improve-rationale/  # POST /api/improve-rationale → improve_rationale
│   ├── components/
│   │   ├── DocumentEditor.tsx
│   │   ├── DocumentList.tsx
│   │   ├── Block.tsx
│   │   ├── ConflictBanner.tsx
│   │   ├── DeleteDocumentButton.tsx
│   │   ├── NewDocumentModal.tsx
│   │   ├── RationaleModal.tsx
│   │   └── StatusPill.tsx
│   └── lib/
│       ├── mcp.ts            # MCP HTTP client + SSE/JSON parser
│       ├── supabase.ts       # Browser Supabase client
│       ├── supabase-server.ts# Server-only Supabase client
│       └── types.ts          # Shared TypeScript types
├── ngrok.yml                 # ngrok tunnel config (gitignored — contains authtoken)
├── .env                      # Server secrets (gitignored)
└── .env.example              # Variable reference
```

---

## Prerequisites

- Node.js 20+
- Supabase project with pgvector enabled and the SpecFlowIA schema applied
- OpenRouter account (embeddings + LLM)
- ngrok account (free tier — 1 static domain included)

---

## Setup

### 1. Clone and install

```bash
git clone <repo>
cd specflow.ai-mcp
npm install
cd editor && npm install && cd ..
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service-role key (not anon key) |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_EMBEDDING_MODEL` | Embedding model (default: `openai/text-embedding-3-small`) |
| `OPENROUTER_MODEL` | Chat model for LLM calls (default: `meta-llama/llama-4-maverick:free`) |
| `MCP_HTTP_PORT` | MCP server port (default: `3001`) |
| `NGROK_AUTHTOKEN` | ngrok authtoken |

```bash
cp editor/.env.local.example editor/.env.local
```

Edit `editor/.env.local`:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (not service key) |
| `NEXT_PUBLIC_MCP_URL` | MCP server URL (e.g. `https://your-domain.ngrok-free.dev/mcp`) |

### 3. Apply Supabase schema

Run the migrations in the Supabase SQL editor. Then create the two required RPC functions:

```sql
-- Similarity search across all blocks (used by relation_detect)
create or replace function match_blocks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  exclude_block_id uuid
)
returns table (
  block_id uuid,
  document_title text,
  content text,
  block_status text,
  similarity float
)
language sql stable as $$
  select
    b.block_id,
    d.title as document_title,
    b.content,
    b.status::text as block_status,
    1 - (b.embedding <=> query_embedding) as similarity
  from block b
  join document d on d.document_id = b.document_id
  where b.block_id <> exclude_block_id
    and b.status::text <> 'deprecated'
    and 1 - (b.embedding <=> query_embedding) > match_threshold
  order by b.embedding <=> query_embedding
  limit match_count;
$$;

-- Similarity search across approved documents only (used by kb_search)
create or replace function match_approved_blocks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_doc_types text[] default null
)
returns table (
  block_id uuid,
  document_id uuid,
  document_title text,
  content text,
  rationale text,
  version int,
  similarity float
)
language sql stable as $$
  select
    b.block_id,
    d.document_id,
    d.title as document_title,
    b.content,
    b.rationale,
    b.version,
    1 - (b.embedding <=> query_embedding) as similarity
  from block b
  join document d on d.document_id = b.document_id
  where d.status = 'approved'
    and (filter_doc_types is null or d.doc_type = any(filter_doc_types::doc_type[]))
    and 1 - (b.embedding <=> query_embedding) > match_threshold
  order by b.embedding <=> query_embedding
  limit match_count;
$$;
```

---

## Running locally

Open three terminals:

```bash
# Terminal 1 — MCP server
npm run dev

# Terminal 2 — ngrok tunnel (public HTTPS endpoint for Claude.ai)
npm run tunnel

# Terminal 3 — web editor
cd editor && npm run dev
```

| Service | URL |
|---|---|
| Web editor | http://localhost:3000 |
| MCP server | http://localhost:3001 |
| Public MCP endpoint | https://your-domain.ngrok-free.dev/mcp |
| Agent prompts | https://your-domain.ngrok-free.dev/agent/prompt?mode=coauthor |

---

## Connecting to Claude.ai

### 1. Add the MCP server

In Claude.ai → **Settings → Integrations → Add MCP server**:

```
https://your-domain.ngrok-free.dev/mcp
```

### 2. Add the project instructions

In your Claude.ai project settings, paste:

```
You are the SpecFlowIA agent.

When starting a session:
1. Ask the PM: "What are we doing? Creating a new document or importing an existing one?"
2. Based on the answer, call GET https://your-domain.ngrok-free.dev/agent/prompt?mode=coauthor or ?mode=ingest
3. Follow exactly the prompt returned by the endpoint
4. Do not follow any other skill or default writing behaviour
```

The agent behaviour is controlled server-side via `GET /agent/prompt` — prompts live in `src/routes/agentPrompt.ts` and can be updated without touching the Claude.ai project settings.

### Agent modes

| Mode | Behaviour |
|---|---|
| `coauthor` | Builds the document block by block in conversation. Asks for rationale before creating. Runs `kb_search` after each `block_create` to detect conflicts. |
| `ingest` | Processes an uploaded file. Asks for import motivation. Chunks content verbatim via LLM. Reports blocks created and any conflicts found. |

---

## MCP tool reference

### Document tools

| Tool | Description |
|---|---|
| `document_create` | Create a document (draft). Accepts optional `rationale`. |
| `document_get` | Retrieve a document with its blocks and relations. |
| `document_publish` | Approve a document. Fails if any block has unresolved conflicts. |
| `document_import` | Create a document from raw text, segmented by blank lines. |
| `document_update_rationale` | Update the rationale of an existing document. |
| `document_ingest` | Semantically chunk raw text via LLM and persist blocks verbatim as draft. |
| `document_delete` | Permanently delete a document and all its blocks (cascade). |
| `improve_rationale` | Generate or improve a document's rationale by analysing its blocks. Returns suggested text — does not save automatically. |

### Block tools

| Tool | Description |
|---|---|
| `block_create` | Add a block to a document. |
| `block_update` | Edit block content. Saves version history and triggers conflict detection. |
| `block_freeze` | Lock or unlock a block against edits. |
| `block_get_history` | List all past versions of a block. |
| `block_reorder` | Change block order in a document. |

### Knowledge base tools

| Tool | Description |
|---|---|
| `relation_detect` | Find semantically similar blocks via pgvector cosine similarity. |
| `relation_register` | Record a typed relation between two blocks (conflict, depends_on, evolves_from, similar). |
| `kb_search` | Semantic search over approved documents. |

---

## Block status lifecycle

```
draft ──► conflict ──► frozen (resolved as "new rule")
  │                       │
  │◄──────────────────────┘ (resolved as "keep existing" → reverts to draft)
  │
  ▼
approved (document published)
  │
  ▼
deprecated (superseded by a newer block)
```

---

## Data model (key tables)

| Table | Purpose |
|---|---|
| `document` | Document metadata — title, type, status, block_order, rationale |
| `block` | Content unit — content, status, rationale, version, embedding |
| `block_version` | Full version history of each block with change_source and rationale |
| `block_relation` | Typed edges between blocks — conflict, depends_on, evolves_from, similar |

---

## ngrok setup

SpecFlowIA requires a public HTTPS URL for Claude.ai to reach the MCP server.

```bash
# Install
npm install -g ngrok

# Register authtoken (once)
npx ngrok config add-authtoken YOUR_TOKEN
# Token at: https://dashboard.ngrok.com/get-started/your-authtoken

# Start tunnel
npm run tunnel
```

The project includes `ngrok.yml` with a static free domain. The authtoken is stored directly in the file (which is gitignored). To use your own static domain, update the `domain:` field in `ngrok.yml`.

---

## Positioning

SpecFlowIA is not a text editor with AI. It is a **versioned knowledge infrastructure** for documents that evolve — closer to an integrity control system than a writing assistant.

The key difference from tools like Notion AI or Confluence: SpecFlowIA tracks *why* content exists, *what it conflicts with*, and *what it evolved from* — turning documents from static artefacts into auditable decision graphs.
