# Prompt para Claude Code — Servidor MCP do SpecFlowIA

Cole esse prompt no Claude Code para iniciar a construção do servidor MCP.

---

## Contexto

Estou construindo o **SpecFlowIA** — um sistema de coautoria assistida por IA para criação e gestão de documentos corporativos (PRDs, políticas, contratos).

A arquitetura tem três partes:
1. **Claude.ai** — interface de chat onde o PM conversa com o agente
2. **Servidor MCP** (o que você vai construir agora) — expõe ferramentas para o agente operar o banco de dados
3. **Editor web** — tela separada onde os documentos são visualizados e editados

O banco de dados já existe no Supabase (Postgres + pgvector) com o seguinte schema:

### Tabelas existentes

```sql
-- Enums: block_status, doc_status, doc_type, change_source, relation_type, relation_origin

document (document_id, title, doc_type, status, block_order uuid[], section_map jsonb, owner_id, approved_at, embedding vector(1536), created_at, updated_at)

block (block_id, document_id, content, status block_status, rationale, frozen_by, version int, embedding vector(1536), created_at, updated_at)

block_version (version_id, block_id, content, rationale, changed_by, change_source, version_number, created_at)
-- Trigger automático: toda vez que block.content muda, a versão anterior é salva em block_version

block_relation (relation_id, source_block_id, target_block_id, relation_type, origin relation_origin, confidence float, description, created_at)
```

---

## O que construir

Um **servidor MCP em TypeScript** usando o SDK oficial `@modelcontextprotocol/sdk`.

### Stack
- TypeScript + Node.js
- `@modelcontextprotocol/sdk` para o servidor MCP
- `@supabase/supabase-js` para acesso ao banco
- `openai` para geração de embeddings (text-embedding-3-small, 1536 dimensões)
- Transporte: `stdio` (padrão para uso com Claude Desktop / Claude.ai)

### Estrutura de pastas

```
specflowia-mcp/
  src/
    index.ts          # entry point — inicializa o servidor MCP
    tools/
      document.ts     # ferramentas de documento
      block.ts        # ferramentas de bloco
      knowledge.ts    # ferramentas de relações e KB
    lib/
      supabase.ts     # cliente Supabase singleton
      embeddings.ts   # função generateEmbedding(text) → number[]
      errors.ts       # erros padronizados
  .env.example
  package.json
  tsconfig.json
  README.md
```

---

## Ferramentas MCP a implementar

### Grupo 1 — Documento

**`document_create`**
- Params: `title` (string, required), `doc_type` (enum: prd|policy|contract|runbook, required), `owner_id` (string uuid, required)
- Ação: INSERT em document, gera embedding do título
- Retorna: document_id, title, status, created_at

**`document_get`**
- Params: `document_id` (string uuid, required)
- Ação: SELECT document + blocos ordenados por block_order + relações ativas
- Retorna: documento completo com blocos e relações

**`document_publish`**
- Params: `document_id` (string uuid, required), `owner_id` (string uuid, required)
- Ação: UPDATE status → 'approved', SET approved_at = now()
- Regra: retorna erro se houver blocos com status = 'conflict'
- Retorna: status, approved_at

**`document_import`**
- Params: `content` (string, required), `doc_type` (enum, required), `owner_id` (string uuid, required), `title` (string, required)
- Ação: cria document + segmenta o content em blocos por parágrafos/seções (heurística simples: quebra em \n\n, mínimo 50 chars por bloco), faz INSERT de todos os blocos, atualiza block_order
- Retorna: document_id, lista de block_ids criados

### Grupo 2 — Bloco

**`block_create`**
- Params: `document_id` (string uuid, required), `content` (string, required), `rationale` (string, optional), `position` (integer, optional)
- Ação: INSERT em block, gera embedding do content, atualiza block_order do documento (append ou insere na posição)
- Retorna: block_id, status, version

**`block_update`**
- Params: `block_id` (string uuid, required), `content` (string, required), `rationale` (string, required), `change_source` (enum: human|agent|mcp, default: agent)
- Regras: retorna erro se block.status = 'frozen'. O trigger do banco já salva a versão anterior automaticamente.
- Ação: UPDATE block SET content, rationale, updated_at. Atualiza embedding.
- Retorna: block_id, version (incrementado pelo trigger), updated_at

**`block_freeze`**
- Params: `block_id` (string uuid, required), `frozen` (boolean, required), `owner_id` (string uuid, required)
- Ação: UPDATE block SET status = frozen ? 'frozen' : 'draft', frozen_by = frozen ? owner_id : null
- Retorna: block_id, status

**`block_get_history`**
- Params: `block_id` (string uuid, required)
- Ação: SELECT * FROM block_version WHERE block_id = ? ORDER BY version_number DESC
- Retorna: lista de versões com content, rationale, changed_by, change_source, created_at

**`block_reorder`**
- Params: `document_id` (string uuid, required), `block_order` (string[] de uuids, required)
- Validação: todos os block_ids devem pertencer ao document_id
- Ação: UPDATE document SET block_order = ?
- Retorna: document_id, block_order

### Grupo 3 — Relações e Knowledge Base

**`relation_detect`**
- Params: `block_id` (string uuid, required), `relation_types` (enum[], optional), `threshold` (float, default: 0.7)
- Ação: busca vetorial por similaridade (embedding do bloco vs todos os blocos aprovados no KB), filtra por threshold, retorna blocos similares com score
- Retorna: lista de { block_id, document_title, content_excerpt, similarity_score, suggested_relation_type }

**`relation_register`**
- Params: `source_block_id` (uuid, required), `target_block_id` (uuid, required), `relation_type` (enum, required), `origin` (enum: structural|inferred, required), `description` (string, required), `confidence` (float, required se origin=inferred)
- Ação: INSERT em block_relation. Se relation_type = 'conflict', atualiza status do source_block para 'conflict'.
- Retorna: relation_id, relation_type, origin

**`kb_search`**
- Params: `query` (string, required), `doc_types` (enum[], optional), `limit` (integer, default: 10)
- Ação: gera embedding da query, busca vetorial em block WHERE document.status = 'approved', retorna blocos ordenados por relevância
- Retorna: lista de { block_id, document_id, document_title, content, rationale, version, similarity_score, relations[] }

---

## Variáveis de ambiente necessárias

```env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=   # usar service key, não anon key
OPENAI_API_KEY=         # para geração de embeddings
```

---

## Regras de implementação

1. Toda ferramenta deve retornar erros descritivos em linguagem natural (o agente lê a resposta de erro e decide o que fazer)
2. Embeddings sempre gerados com `text-embedding-3-small` da OpenAI, dimensão 1536
3. Busca vetorial com operador `<=>` (cosine distance) do pgvector via RPC do Supabase ou query SQL direta
4. O servidor deve logar cada chamada de ferramenta no stderr (não no stdout — stdout é reservado para o protocolo MCP)
5. Usar zod para validação dos parâmetros de entrada de cada ferramenta

---

## README.md deve incluir

- Como instalar e configurar o .env
- Como rodar localmente: `npx ts-node src/index.ts`
- Como configurar no Claude Desktop (claude_desktop_config.json)
- Exemplo de uso de cada ferramenta

---

Pode começar. Crie toda a estrutura de pastas e arquivos. Priorize que o servidor suba sem erros antes de implementar todas as ferramentas — implemente na ordem: `document_create` → `block_create` → `block_update` → `kb_search`.
