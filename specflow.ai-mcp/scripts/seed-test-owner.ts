/**
 * seed-test-owner.ts
 *
 * Popula o Supabase com dados de teste para o owner 0002.
 * Cobre os 5 cenários de detecção de relações do SpecFlowIA:
 *   conflict | depends_on | similar | evolves_from | graph-only (source='graph')
 *
 * Pré-requisitos:
 *   - MCP server rodando em MCP_URL (default: http://localhost:3001)
 *   - Variáveis SUPABASE_URL e SUPABASE_SERVICE_KEY no .env
 *
 * Uso:
 *   npm run seed:test
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// ─── Config ───────────────────────────────────────────────────────────────────

const OWNER_ID = '00000000-0000-0000-0000-000000000002'
const MCP_URL  = process.env.MCP_URL ?? 'http://localhost:3001'

// ─── Supabase (para limpeza e aprovação de documentos) ────────────────────────

function getSb() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios')
  return createClient(url, key, { auth: { persistSession: false } })
}

// ─── MCP HTTP helper ──────────────────────────────────────────────────────────

async function callMCP<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  })

  const raw = await res.text()

  // The server may respond with SSE (text/event-stream) or plain JSON.
  // SSE lines look like:  "event: message\ndata: {...}\n\n"
  // Extract the first `data:` line and parse it as JSON.
  let jsonText = raw.trim()
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const dataLine = raw.split('\n').find(l => l.startsWith('data:'))
    if (!dataLine) throw new Error(`Nenhuma linha data: na resposta SSE de ${tool}:\n${raw}`)
    jsonText = dataLine.slice('data:'.length).trim()
  }

  const payload = JSON.parse(jsonText) as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: Array<{ text: string }> }
  }

  if (payload.error) throw new Error(payload.error.message ?? JSON.stringify(payload.error))
  const text = payload.result?.content?.[0]?.text
  if (text === undefined) throw new Error(`Resposta MCP inesperada para ${tool}: ${jsonText}`)
  if (payload.result?.isError) throw new Error(`[${tool}] ${text}`)
  return JSON.parse(text) as T
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function main() {
  const sb = getSb()

  // ── 1. Limpar dados existentes do owner 0002 ─────────────────────────────

  console.log('🧹 Limpando dados do owner 0002…')
  const { data: existingDocs } = await sb
    .from('document')
    .select('document_id')
    .eq('owner_id', OWNER_ID)

  for (const doc of existingDocs ?? []) {
    await sb.from('document').delete().eq('document_id', doc.document_id)
  }
  console.log(`   Removidos ${existingDocs?.length ?? 0} documento(s).`)

  // ── 2. Documento fonte ───────────────────────────────────────────────────
  // O usuário abrirá este documento no editor e editará o bloco para disparar
  // o relation_detect. Deixar como draft (o editor trabalha com drafts).

  console.log('\n📄 [1/4] Criando "Política de Férias e Ausências" (draft)…')
  const doc1 = await callMCP<{ document_id: string }>('document_create', {
    title:    'Política de Férias e Ausências',
    doc_type: 'policy',
    owner_id: OWNER_ID,
    rationale: 'Define os direitos e procedimentos para o gozo de férias dos colaboradores.',
  })

  const blockFonte = await callMCP<{ block_id: string }>('block_create', {
    document_id: doc1.document_id,
    content: 'Os colaboradores têm direito a 30 dias corridos de férias anuais remuneradas após completar 12 meses de trabalho, conforme a legislação trabalhista vigente.',
    rationale:  'Regra principal de férias — alinhada com a CLT.',
  })
  console.log(`   ✅ Bloco fonte:  ${blockFonte.block_id}`)

  // ── 3. Documento com cenários: conflict · depends_on · similar ───────────
  // Aprovado para ser encontrado pelo vector search.

  console.log('\n📄 [2/4] Criando "Regulamento Interno de RH" (approved)…')
  const doc2 = await callMCP<{ document_id: string }>('document_create', {
    title:    'Regulamento Interno de RH',
    doc_type: 'policy',
    owner_id: OWNER_ID,
    rationale: 'Regulamento operacional do departamento de Recursos Humanos.',
  })

  // CONFLICT — contradiz diretamente o bloco fonte (15 dias vs 30 dias)
  const blockConflict = await callMCP<{ block_id: string }>('block_create', {
    document_id: doc2.document_id,
    content: 'O período de descanso anual é fixado em 15 dias úteis, sem possibilidade de fracionamento, a serem usufruídos integralmente no primeiro semestre após a data de aniversário do contrato.',
    rationale:  'Regra legada de descanso — revisar alinhamento com a Política de Férias.',
  })
  console.log(`   ✅ Bloco CONFLICT:    ${blockConflict.block_id}`)

  // DEPENDS_ON — referencia explicitamente a Política de Férias
  const blockDependsOn = await callMCP<{ block_id: string }>('block_create', {
    document_id: doc2.document_id,
    content: 'O agendamento de férias deve respeitar integralmente as regras e limites definidos na Política de Férias e Ausências vigente, com solicitação prévia de 30 dias e aprovação formal do gestor direto.',
    rationale:  'Procedimento de agendamento — depende da Política de Férias.',
  })
  console.log(`   ✅ Bloco DEPENDS_ON: ${blockDependsOn.block_id}`)

  // SIMILAR — mesmo tema (férias), sem contradição
  const blockSimilar = await callMCP<{ block_id: string }>('block_create', {
    document_id: doc2.document_id,
    content: 'O gozo das férias anuais pode ser fracionado em até três períodos, desde que o primeiro período seja de no mínimo 14 dias corridos, conforme permitido pela legislação trabalhista.',
    rationale:  'Regra de fracionamento de férias — complementa a Política de Férias.',
  })
  console.log(`   ✅ Bloco SIMILAR:    ${blockSimilar.block_id}`)

  // Aprovar documento 2 (targets precisam estar em documentos acessíveis pelo vector search)
  await sb.from('document').update({ status: 'approved' }).eq('document_id', doc2.document_id)
  console.log('   📌 Documento aprovado.')

  // ── 4. Documento graph-only ──────────────────────────────────────────────
  // Texto sem similaridade semântica com o bloco fonte (backup/TI).
  // Será descoberto SOMENTE via grafo (B_dependsOn depends_on este bloco).

  console.log('\n📄 [3/4] Criando "Política de Continuidade e Backup de TI" (approved)…')
  const doc3 = await callMCP<{ document_id: string }>('document_create', {
    title:    'Política de Continuidade e Backup de TI',
    doc_type: 'policy',
    owner_id: OWNER_ID,
    rationale: 'Define os procedimentos de backup e continuidade dos sistemas corporativos.',
  })

  // GRAPH-ONLY — texto sobre backup de TI, sem relação semântica com férias.
  // Será conectado ao bloco DEPENDS_ON via relação pré-existente.
  const blockGraphOnly = await callMCP<{ block_id: string }>('block_create', {
    document_id: doc3.document_id,
    content: 'O processo de backup dos sistemas críticos é executado diariamente às 23h00 em ambiente de armazenamento redundante geograficamente distribuído. A retenção segue a política 30-12-12: 30 dias para backups diários, 12 semanas para semanais e 12 meses para mensais.',
    rationale:  'Rotina de backup — base para SLA de disponibilidade dos sistemas.',
  })
  console.log(`   ✅ Bloco GRAPH-ONLY: ${blockGraphOnly.block_id}`)

  await sb.from('document').update({ status: 'approved' }).eq('document_id', doc3.document_id)
  console.log('   📌 Documento aprovado.')

  // ── 5. Documento legado (evolves_from) ───────────────────────────────────

  console.log('\n📄 [4/4] Criando "Política de Férias — Versão Legada" (approved)…')
  const doc4 = await callMCP<{ document_id: string }>('document_create', {
    title:    'Política de Férias — Versão Legada',
    doc_type: 'policy',
    owner_id: OWNER_ID,
    rationale: 'Versão anterior da política de férias, mantida para rastreabilidade histórica.',
  })

  // EVOLVES_FROM — versão antiga (20 dias), substituída pelo bloco fonte (30 dias)
  const blockEvolvesFrom = await callMCP<{ block_id: string }>('block_create', {
    document_id: doc4.document_id,
    content: 'Funcionários com mais de 12 meses de empresa têm direito a 20 dias de férias anuais, podendo ser fracionadas em até dois períodos mediante autorização prévia do departamento pessoal.',
    rationale:  'Regra de férias anterior à revisão de 2023 — substituída pela versão vigente.',
  })
  console.log(`   ✅ Bloco EVOLVES_FROM: ${blockEvolvesFrom.block_id}`)

  await sb.from('document').update({ status: 'approved' }).eq('document_id', doc4.document_id)
  console.log('   📌 Documento aprovado.')

  // ── 6. Relação pré-existente (ativa o graph traversal) ──────────────────
  // blockDependsOn depends_on blockGraphOnly
  // Lógica: o procedimento de agendamento de férias (B_dependsOn) depende do
  // sistema de backup estar disponível (B_graphOnly) para registrar as aprovações.
  // Quando relation_detect roda no bloco fonte e encontra B_dependsOn via vector,
  // o graphExpand descobre B_graphOnly via esta relação — sem similaridade vetorial.

  console.log('\n🔗 Registrando relação pré-existente para cenário graph-only…')
  await callMCP('relation_register', {
    source_block_id: blockDependsOn.block_id,
    target_block_id: blockGraphOnly.block_id,
    relation_type:   'depends_on',
    origin:          'structural',
    description:     'O sistema de registro e aprovação de férias depende da disponibilidade do backup dos sistemas corporativos para garantir a integridade das solicitações.',
    confidence:      0.9,
  })
  console.log(`   ✅ ${blockDependsOn.block_id} depends_on ${blockGraphOnly.block_id}`)

  // ── 7. Resumo ────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(60))
  console.log('✅ Seed concluído! Resumo dos cenários:\n')
  console.log(`📄 Política de Férias e Ausências  (document_id: ${doc1.document_id})`)
  console.log(`   ↳ Bloco FONTE (edite este):       ${blockFonte.block_id}`)
  console.log('')
  console.log(`📄 Regulamento Interno de RH        (document_id: ${doc2.document_id})`)
  console.log(`   ↳ Bloco CONFLICT:                 ${blockConflict.block_id}`)
  console.log(`      "15 dias úteis" ↔ "30 dias corridos" → contradição direta`)
  console.log(`   ↳ Bloco DEPENDS_ON:               ${blockDependsOn.block_id}`)
  console.log(`      Referencia explicitamente a Política de Férias vigente`)
  console.log(`   ↳ Bloco SIMILAR:                  ${blockSimilar.block_id}`)
  console.log(`      Fala de fracionamento — mesmo tema, sem contradição`)
  console.log('')
  console.log(`📄 Continuidade e Backup de TI      (document_id: ${doc3.document_id})`)
  console.log(`   ↳ Bloco GRAPH-ONLY:               ${blockGraphOnly.block_id}`)
  console.log(`      Texto sobre backup — sem similaridade vetorial com o fonte`)
  console.log(`      Descoberto via grafo: fonte→(vector)→DEPENDS_ON→(graph)→este`)
  console.log('')
  console.log(`📄 Política de Férias — Versão Legada (document_id: ${doc4.document_id})`)
  console.log(`   ↳ Bloco EVOLVES_FROM:             ${blockEvolvesFrom.block_id}`)
  console.log(`      "20 dias" (antigo) → evoluído para "30 dias" (atual)`)
  console.log('')
  console.log('─'.repeat(60))
  console.log('💡 Como testar:')
  console.log('   1. Acesse o editor como PM Beta (owner 0002)')
  console.log('   2. Abra "Política de Férias e Ausências"')
  console.log('   3. Clique no bloco fonte, adicione um caractere e clique fora')
  console.log('   4. Aguarde os banners aparecerem com os 5 cenários')
  console.log('─'.repeat(60))
}

main().catch((err) => {
  console.error('\n❌ Erro durante o seed:', err)
  process.exit(1)
})
