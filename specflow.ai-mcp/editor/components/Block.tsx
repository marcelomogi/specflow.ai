'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useState, useCallback, useRef } from 'react'
import type { Block as BlockType, BlockRelation, BlockVersion } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import { callMCP, McpOfflineError } from '@/lib/mcp'
import StatusPill from './StatusPill'
import ConflictBanner from './ConflictBanner'
import RationaleModal from './RationaleModal'

// Shape returned by relation_detect (new pipeline: LLM-classified + graph-expanded)
interface DetectedRelation {
  block_id: string
  document_title: string
  content_excerpt: string
  block_status?: string
  similarity_score: number | null   // null for graph-only candidates
  relation_type: string             // classified by LLM
  confidence: number
  explanation: string
  origin: 'inferred'
  source: 'vector' | 'graph'
}

// Pending conflict waiting for PM confirmation
interface PendingConflict {
  detected: DetectedRelation
}

interface Props {
  block: BlockType
  index: number
  relations: BlockRelation[]
  isRecentlyUpdated: boolean
  mcpOffline: boolean
  ownerId: string
  onMcpOffline: () => void
  onSelect: (blockId: string, history: BlockVersion[]) => void
  onBlockChange: (updated: BlockType) => void
}

export default function Block({
  block,
  index,
  relations,
  isRecentlyUpdated,
  ownerId,
  onMcpOffline,
  onSelect,
  onBlockChange,
}: Props) {
  const [isSaving, setIsSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [pendingConflicts, setPendingConflicts] = useState<PendingConflict[]>([])
  const [isRegistering, setIsRegistering] = useState(false)
  const sb = createClient()

  // Keep a ref to current block so callbacks always see fresh values
  const blockRef = useRef(block)
  useEffect(() => { blockRef.current = block }, [block])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Escreva o conteúdo do bloco...' }),
    ],
    content: block.content,
    editable: block.status !== 'frozen',
    editorProps: {
      attributes: { class: 'tiptap' },
    },
    onBlur: ({ editor }) => {
      const newContent = editor.getText({ blockSeparator: '\n\n' })
      if (newContent !== blockRef.current.content) {
        handleSave(newContent)
      }
    },
  })

  // Sync content when block updated externally (Realtime)
  useEffect(() => {
    if (!editor) return
    const currentText = editor.getText({ blockSeparator: '\n\n' })
    if (currentText !== block.content && !editor.isFocused) {
      editor.commands.setContent(block.content)
    }
  }, [block.content, editor])

  // Sync editable state
  useEffect(() => {
    if (!editor) return
    editor.setEditable(block.status !== 'frozen')
  }, [block.status, editor])

  // ── Save via MCP (with Supabase fallback) ────────────────────────────────
  const handleSave = useCallback(async (content: string) => {
    setIsSaving(true)
    const current = blockRef.current

    try {
      // block_update returns only {block_id, version, updated_at} — merge with current
      const patch = await callMCP<Partial<BlockType>>('block_update', {
        block_id: current.block_id,
        content,
        rationale: current.rationale ?? '',
        change_source: 'human',
      })
      onBlockChange({ ...current, content, ...patch })

      // Detect conflicts in background — intentionally not awaited
      detectConflicts(current.block_id)

    } catch (err) {
      if (err instanceof McpOfflineError) {
        onMcpOffline()
        // Fallback: save directly to Supabase without embedding
        await sb.from('block').update({
          content,
          updated_at: new Date().toISOString(),
        }).eq('block_id', current.block_id)
        onBlockChange({ ...current, content })
      } else {
        console.error('[Block] save error:', err)
      }
    } finally {
      setIsSaving(false)
    }
  }, [sb, onBlockChange, onMcpOffline]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Relation detect after save ────────────────────────────────────────────
  async function detectConflicts(blockId: string) {
    console.log('[detectConflicts] chamando relation_detect para', blockId)
    try {
      const results = await callMCP<DetectedRelation[]>('relation_detect', {
        block_id: blockId,
        // No relation_types filter — let LLM classify all types; server already excludes 'none'
        threshold: 0.75,
      })

      console.log('[detectConflicts] resultados brutos:', results)

      // All returned results are LLM-classified (non-'none'). Only exclude deprecated blocks.
      // Graph candidates (source='graph') have similarity_score=null — still show them.
      const potentialConflicts = results.filter(
        r => r.block_status !== 'deprecated'
      )

      console.log('[detectConflicts] relações detectadas:', potentialConflicts)

      if (potentialConflicts.length > 0) {
        setPendingConflicts(potentialConflicts.map(r => ({ detected: r })))
      }
    } catch (err) {
      console.error('[detectConflicts] erro:', err)
    }
  }

  // ── Register confirmed relation ───────────────────────────────────────────
  async function handleRegisterConflict(pending: PendingConflict) {
    setIsRegistering(true)
    const { relation_type, confidence, explanation, document_title, block_id: targetId, similarity_score } = pending.detected
    try {
      await callMCP('relation_register', {
        source_block_id: block.block_id,
        target_block_id: targetId,
        relation_type,
        origin: 'inferred',
        description: `${explanation} (fonte: "${document_title}"${similarity_score != null ? `, similaridade ${Math.round(similarity_score * 100)}%` : ', via grafo de relações'})`,
        confidence,
      })
      // Only mark block as 'conflict' when the relation type is actually conflict
      if (relation_type === 'conflict') {
        onBlockChange({ ...blockRef.current, status: 'conflict' })
      }
      // For depends_on / evolves_from / similar the block stays in its current status;
      // the relation is recorded in the DB for graph traversal
    } catch (err) {
      console.error('[Block] relation_register error:', err)
    } finally {
      setIsRegistering(false)
      setPendingConflicts(prev => prev.filter(p => p !== pending))
    }
  }

  function handleDismissConflict(pending: PendingConflict) {
    setPendingConflicts(prev => prev.filter(p => p !== pending))
  }

  // ── Freeze toggle ─────────────────────────────────────────────────────────
  async function handleFreeze() {
    const nextFrozen = block.status !== 'frozen'
    const { data } = await sb
      .from('block')
      .update({
        status: nextFrozen ? 'frozen' : 'draft',
        frozen_by: nextFrozen ? ownerId : null,
      })
      .eq('block_id', block.block_id)
      .select()
      .single()
    if (data) onBlockChange(data as BlockType)
  }

  // ── History ───────────────────────────────────────────────────────────────
  async function handleHistory() {
    const { data } = await sb
      .from('block_version')
      .select('*')
      .eq('block_id', block.block_id)
      .order('version_number', { ascending: false })
    onSelect(block.block_id, (data ?? []) as BlockVersion[])
  }

  const isFrozen = block.status === 'frozen'
  const isConflict = block.status === 'conflict'

  return (
    <div
      className={`relative flex flex-col gap-2 rounded-xl border p-4 transition-all ${
        isConflict
          ? 'border-red-300 bg-red-50/40'
          : isFrozen
          ? 'border-blue-200 bg-blue-50/20'
          : 'border-gray-200 bg-white'
      } ${isRecentlyUpdated ? 'ring-2 ring-indigo-300 ring-offset-1' : ''}`}
    >
      {/* Recently-updated flash label */}
      {isRecentlyUpdated && (
        <span className="absolute -top-2.5 right-4 text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-medium">
          atualizado pelo agente
        </span>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono text-gray-400">bloco {index + 1}</span>
        <StatusPill value={block.status} />

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleFreeze}
            title={isFrozen ? 'Descongelar bloco' : 'Congelar bloco'}
            className={`p-1.5 rounded-lg text-sm transition ${
              isFrozen
                ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
          >
            {isFrozen ? '🔒' : '🔓'}
          </button>

          <button
            onClick={() => setShowModal(true)}
            title="Solicitar revisão ao agente"
            className="p-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-100 hover:text-indigo-500 transition"
          >
            ✨
          </button>

          <button
            onClick={handleHistory}
            title="Ver histórico de versões"
            className="p-1.5 rounded-lg text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition"
          >
            🕐
          </button>
        </div>

        {isSaving && (
          <span className="text-[11px] text-gray-400 animate-pulse">salvando…</span>
        )}
      </div>

      {/* Existing conflict banner (from DB relations) */}
      {isConflict && (
        <ConflictBanner
          blockId={block.block_id}
          relations={relations}
          onBlockChange={(patch) => onBlockChange({ ...blockRef.current, ...patch })}
        />
      )}

      {/* Pending relation banners (from relation_detect, awaiting PM confirmation) */}
      {pendingConflicts.map((pending, i) => {
        const { relation_type, source, similarity_score, confidence, explanation, document_title, content_excerpt } = pending.detected

        const RELATION_LABEL: Record<string, string> = {
          conflict:     '⚠️ Conflito detectado',
          depends_on:   '🔗 Dependência detectada',
          evolves_from: '🔄 Evolução detectada',
          similar:      '📄 Conteúdo similar detectado',
        }
        const RELATION_VERB: Record<string, string> = {
          conflict:     'contradiz',
          depends_on:   'depende de',
          evolves_from: 'parece evoluir de',
          similar:      'cobre território similar a',
        }

        const label = RELATION_LABEL[relation_type] ?? '🔍 Relação detectada'
        const verb  = RELATION_VERB[relation_type]  ?? 'se relaciona com'
        const pct   = Math.round(confidence * 100)

        return (
          <div
            key={i}
            className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800"
          >
            <div className="flex-1 min-w-0">
              {/* Header row */}
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold">{label}</p>

                {/* Source badge */}
                {source === 'graph' ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                    via relação
                  </span>
                ) : similarity_score != null ? (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded font-bold tabular-nums ${
                      similarity_score >= 0.90
                        ? 'bg-red-100 text-red-700'
                        : similarity_score >= 0.80
                        ? 'bg-amber-200 text-amber-800'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {Math.round(similarity_score * 100)}% similar
                  </span>
                ) : null}

                {/* LLM confidence */}
                <span className="text-amber-500 tabular-nums">{pct}% confiança</span>
              </div>

              {/* Relation description */}
              <p className="mt-0.5 text-amber-700">
                Este bloco <span className="font-medium">{verb}</span>{' '}
                &ldquo;{document_title}&rdquo;
              </p>

              {/* LLM explanation */}
              <p className="mt-0.5 text-amber-600 italic">{explanation}</p>

              {/* Conflicting block excerpt */}
              <p className="mt-1 text-amber-500 line-clamp-2 italic">
                &ldquo;{content_excerpt}&rdquo;
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
              <button
                onClick={() => handleRegisterConflict(pending)}
                disabled={isRegistering}
                className="px-2 py-1 rounded-md bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 disabled:opacity-50 transition"
              >
                {isRegistering ? '…' : 'Registrar'}
              </button>
              <button
                onClick={() => handleDismissConflict(pending)}
                className="px-2 py-1 rounded-md border border-amber-300 text-amber-700 text-[11px] hover:bg-amber-100 transition"
              >
                Ignorar
              </button>
            </div>
          </div>
        )
      })}

      {/* TipTap editor */}
      <div className={`rounded-lg px-1 ${isFrozen ? 'opacity-60 cursor-not-allowed' : ''}`}>
        <EditorContent editor={editor} />
      </div>

      {/* Rationale */}
      <p className="text-xs text-gray-400 border-t border-gray-100 pt-2">
        {block.rationale ? (
          <span>
            <span className="font-medium text-gray-500">Justificativa:</span>{' '}
            {block.rationale}
          </span>
        ) : (
          <span className="italic">sem justificativa registrada</span>
        )}
      </p>

      {showModal && (
        <RationaleModal
          blockContent={block.content}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
