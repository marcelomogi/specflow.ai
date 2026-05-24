'use client'

import { useState, useEffect } from 'react'
import type { BlockRelation, BlockStatus } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import { callMCP } from '@/lib/mcp'

interface ConflictingBlockInfo {
  content: string
  document_title: string
}

interface Props {
  blockId: string
  relations: BlockRelation[]
  onBlockChange: (updates: Partial<{ status: BlockStatus }>) => void
}

export default function ConflictBanner({ blockId, relations, onBlockChange }: Props) {
  const conflicts = relations.filter(r => r.relation_type === 'conflict')
  const [dismissed, setDismissed] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [blockInfoMap, setBlockInfoMap] = useState<Record<string, ConflictingBlockInfo>>({})
  const sb = createClient()

  // Fetch content + document title for each conflicting target block
  useEffect(() => {
    if (conflicts.length === 0) return

    const ids = conflicts.map(r => r.target_block_id)
    sb.from('block')
      .select('block_id, content, document_id')
      .in('block_id', ids)
      .then(async ({ data: blocks }) => {
        if (!blocks || blocks.length === 0) return

        const docIds = Array.from(new Set(blocks.map(b => b.document_id)))
        const { data: docs } = await sb
          .from('document')
          .select('document_id, title')
          .in('document_id', docIds)

        const docTitleMap: Record<string, string> = {}
        for (const d of docs ?? []) {
          docTitleMap[d.document_id] = d.title
        }

        const map: Record<string, ConflictingBlockInfo> = {}
        for (const b of blocks) {
          map[b.block_id] = {
            content: b.content,
            document_title: docTitleMap[b.document_id] ?? 'Documento desconhecido',
          }
        }
        setBlockInfoMap(map)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflicts.length])

  if (conflicts.length === 0 || dismissed) return null

  // ── Resolution handlers ────────────────────────────────────────────────────

  async function handleNewRule(relation: BlockRelation) {
    setResolving(relation.relation_id + ':new_rule')
    try {
      // 1. Freeze current block (this becomes the authoritative rule)
      await sb
        .from('block')
        .update({ status: 'frozen' })
        .eq('block_id', blockId)

      // 2. Register evolves_from relation (current block evolves from conflicting one)
      await callMCP('relation_register', {
        source_block_id: blockId,
        target_block_id: relation.target_block_id,
        relation_type: 'evolves_from',
        origin: 'inferred',
        description: `Esta regra substitui o bloco conflitante registrado em "${blockInfoMap[relation.target_block_id]?.document_title ?? 'documento anterior'}".`,
        confidence: relation.confidence ?? 1.0,
      })

      // 3. Deprecate the conflicting block
      await sb
        .from('block')
        .update({ status: 'deprecated' })
        .eq('block_id', relation.target_block_id)

      // Notify parent: current block is now frozen
      onBlockChange({ status: 'frozen' as BlockStatus })
    } catch (err) {
      console.error('[ConflictBanner] handleNewRule error:', err)
    } finally {
      setResolving(null)
    }
  }

  async function handleKeepExisting(relation: BlockRelation) {
    setResolving(relation.relation_id + ':keep_existing')
    try {
      // 1. Revert current block to draft
      await sb
        .from('block')
        .update({ status: 'draft' })
        .eq('block_id', blockId)

      // 2. Delete the conflict relation
      await sb
        .from('block_relation')
        .delete()
        .eq('relation_id', relation.relation_id)

      // Notify parent: current block is now draft
      onBlockChange({ status: 'draft' as BlockStatus })
    } catch (err) {
      console.error('[ConflictBanner] handleKeepExisting error:', err)
    } finally {
      setResolving(null)
    }
  }

  function handleLater() {
    setDismissed(true)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-3 text-xs text-red-700">
      <div className="flex items-center gap-2">
        <span className="shrink-0">🚨</span>
        <span className="font-semibold text-red-800">Conflito registrado — resolução necessária</span>
      </div>

      {conflicts.map(r => {
        const info = blockInfoMap[r.target_block_id]
        const isResolvingThis = resolving?.startsWith(r.relation_id)

        return (
          <div key={r.relation_id} className="flex flex-col gap-2 bg-white border border-red-100 rounded-lg p-2.5">
            {/* Conflict description */}
            <p className="text-red-700">{r.description}</p>

            {/* Conflicting block context */}
            {info ? (
              <div className="bg-red-50 rounded px-2 py-1.5 space-y-0.5">
                <p className="font-medium text-red-600 truncate">
                  📄 {info.document_title}
                </p>
                <p className="text-red-500 italic line-clamp-2">
                  &ldquo;{info.content.slice(0, 200)}{info.content.length > 200 ? '…' : ''}&rdquo;
                </p>
              </div>
            ) : (
              <p className="text-red-400 italic">Carregando contexto do bloco conflitante…</p>
            )}

            {/* Confidence badge */}
            {r.confidence != null && (
              <p className="text-red-400">
                Similaridade:{' '}
                <span className="font-bold tabular-nums">
                  {Math.round(r.confidence * 100)}%
                </span>
              </p>
            )}

            {/* Resolution actions */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-red-100">
              <button
                onClick={() => handleNewRule(r)}
                disabled={!!resolving}
                className="px-2.5 py-1 rounded-md bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 transition"
              >
                {isResolvingThis && resolving?.endsWith(':new_rule') ? '…' : '✅ Esta é a nova regra'}
              </button>

              <button
                onClick={() => handleKeepExisting(r)}
                disabled={!!resolving}
                className="px-2.5 py-1 rounded-md bg-white border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 transition"
              >
                {isResolvingThis && resolving?.endsWith(':keep_existing') ? '…' : '↩️ Manter regra existente'}
              </button>

              <button
                onClick={handleLater}
                disabled={!!resolving}
                className="px-2.5 py-1 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
              >
                🕐 Resolver depois
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
