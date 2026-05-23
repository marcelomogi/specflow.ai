# SpecFlowIA Editor

Editor web do SpecFlowIA — visualiza e edita documentos corporativos em tempo real enquanto o agente IA opera via MCP.

## Stack

- **Next.js 14** (App Router)
- **Tailwind CSS**
- **Supabase** (dados + Realtime)
- **TipTap** (editor de blocos)

## Setup

### 1. Variáveis de ambiente

Adicione as seguintes entradas no `.env` da raiz do projeto (`specflow.ai-mcp/.env`):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

> Use a **anon key** (não a service key). O editor roda no browser.
> As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` já existem para o servidor MCP.

Em desenvolvimento, crie `editor/.env.local` com as variáveis acima (o Next.js carrega `.env.local` automaticamente).

### 2. Instalar e rodar

```bash
cd editor
npm install
npm run dev   # http://localhost:3000
```

### 3. Build para produção

```bash
npm run build
npm start
```

## Deploy na Vercel

```bash
vercel --cwd editor
```

Configure no dashboard da Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Telas

| Rota | Descrição |
|---|---|
| `/` | Lista de documentos com status, tipo, contagem de blocos |
| `/documents/[id]` | Editor de documento com blocos TipTap e sidebar de metadados |

## Realtime

O editor assina o canal `document:{id}` do Supabase Realtime. Quando o agente MCP atualiza um bloco, a mudança é refletida imediatamente com um badge "atualizado pelo agente" por 4 segundos.

## Owner hardcoded

Até ter autenticação, o `owner_id` fixo é `00000000-0000-0000-0000-000000000001`.
