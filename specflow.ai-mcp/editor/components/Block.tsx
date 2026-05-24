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

const OWNER_ID = '00000000-0000-0000-0000-000000000001'
const CONFLICT_SIMILARITY_THRESHOLD = 0.75

// Shape returned by relation_detect
interface DetectedRelation {
  block_id: string
  document_title: string
  content_excerpt: string
  similarity_score: number
  suggested_relation_type: string
  block_status?: string
}

// Pending conflict waiting for PM confirmation
interface PendingConflict {
  detected: DetectedRelation
}

interface Props {
  block: BlockType
  index: number
  relations: BlockRelation[]
  relatedTitles: Record<string, string>
  isRecentlyUpdated: boolean
  mcpOffline: boolean
  onMcpOffline: () => void
  onSelect: (blockId: string, history: BlockVersion[]) => void
  onBlockChange: (updated: BlockType) => void
}

export default function Block({
  block,
  index,
  relations,
  relatedTitles: _relatedTitles,
  isRecentlyUpdated,
  mcpOffline: _mcpOffline,
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
        relation_types: ['conflict', 'similar'],
        threshold: 0.75,
      })

      console.log('[detectConflicts] resultados brutos:', results)

      const potentialConflicts = results.filter(
        r =>
          r.similarity_score >= CONFLICT_SIMILARITY_THRESHOLD &&
          r.block_status !== 'deprecated'
      )

      console.log(
        `[detectConflicts] acima do threshold ${CONFLICT_SIMILARITY_THRESHOLD}:`,
        potentialConflicts
      )

      if (potentialConflicts.length > 0) {
        setPendingConflicts(potentialConflicts.map(r => ({ detected: r })))
      }
    } catch (err) {
      console.error('[detectConflicts] erro:', err)
    }
  }

  // ── Register confirmed conflict ───────────────────────────────────────────
  async function handleRegisterConflict(pending: PendingConflict) {
    setIsRegistering(true)
    try {
      await callMCP('relation_register', {
        source_block_id: block.block_id,
        target_block_id: pending.detected.block_id,
        relation_type: 'conflict',
        origin: 'inferred',
        description: `Conflito detectado com "${pending.detected.document_title}" (similaridade ${Math.round(pending.detected.similarity_score * 100)}%)`,
        confidence: pending.detected.similarity_score,
      })
      // relation_register sets source block status to 'conflict' on the server;
      // Realtime will propagate the block update, but we update locally too
      onBlockChange({ ...blockRef.current, status: 'conflict' })
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
        frozen_by: nextFrozen ? OWNER_ID : null,
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
          relatedTitles={relatedTitles}
          onBlockChange={(patch) => onBlockChange({ ...blockRef.current, ...patch })}
        />
      )}

      {/* Pending conflict banners (from relation_detect, awaiting PM confirmation) */}
      {pendingConflicts.map((pending, i) => {
        const pct = Math.round(pending.detected.similarity_score * 100)
        const strength = pct >= 90 ? 'sugestão forte' : pct >= 80 ? 'sugestão moderada' : 'sugestão fraca'
        return (
          <div
            key={i}
            className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800"
          >
            <span className="mt-0.5 shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold">Possível conflito detectado</p>
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded font-bold tabular-nums ${
                    pct >= 90
                      ? 'bg-red-100 text-red-700'
                      : pct >= 80
                      ? 'bg-amber-200 text-amber-800'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {pct}%
                </span>
                <span className="text-amber-500">{strength}</span>
              </div>
              <p className="mt-0.5 text-amber-700 truncate">
                Com &ldquo;{pending.detected.document_title}&rdquo;
              </p>
              <p className="mt-1 text-amber-600 line-clamp-2 italic">
                &ldquo;{pending.detected.content_excerpt}&rdquo;
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
              <button
                onClick={() => handleRegisterConflict(pending)}
                disabled={isRegistering}
                className="px-2 py-1 rounded-md bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 disabled:opacity-50 transition"
              >
                {isRegistering ? '…' : 'Registrar conflito'}
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
      }
      )}

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
