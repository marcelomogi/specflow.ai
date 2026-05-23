'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Document, Block as BlockType, BlockRelation, BlockVersion } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import { callMCP, McpOfflineError } from '@/lib/mcp'
import Block from './Block'
import BlockMetadata from './BlockMetadata'
import StatusPill from './StatusPill'
import DeleteDocumentButton from './DeleteDocumentButton'

interface Props {
  initialDoc: Document
  initialBlocks: BlockType[]
  initialRelations: BlockRelation[]
}

export default function DocumentEditor({ initialDoc, initialBlocks, initialRelations }: Props) {
  const [doc, setDoc] = useState(initialDoc)
  const [blocks, setBlocks] = useState(initialBlocks)
  const [relations] = useState(initialRelations)
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(new Set())
  const [selectedHistory, setSelectedHistory] = useState<BlockVersion[]>([])
  const [isPublishing, setIsPublishing] = useState(false)
  const [isAddingBlock, setIsAddingBlock] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(doc.title)
  const [rationaleValue, setRationaleValue] = useState(doc.rationale ?? '')
  const [mcpOffline, setMcpOffline] = useState(false)
  const [isImprovingRationale, setIsImprovingRationale] = useState(false)
  const sb = createClient()
  const router = useRouter()

  const orderedBlocks = doc.block_order
    .map(id => blocks.find(b => b.block_id === id))
    .filter((b): b is BlockType => !!b)

  const conflictCount = blocks.filter(b => b.status === 'conflict').length
  const frozenCount = blocks.filter(b => b.status === 'frozen').length
  const hasConflicts = conflictCount > 0

  const relatedTitles: Record<string, string> = {}

  const handleMcpOffline = useCallback(() => setMcpOffline(true), [])

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    const channel = sb
      .channel(`document:${doc.document_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'block',
          filter: `document_id=eq.${doc.document_id}`,
        },
        (payload) => {
          const updated = payload.new as BlockType

          setBlocks(prev => {
            const exists = prev.some(b => b.block_id === updated.block_id)
            return exists
              ? prev.map(b => b.block_id === updated.block_id ? updated : b)
              : [...prev, updated]
          })

          setRecentlyUpdated(prev => new Set(prev).add(updated.block_id))
          setTimeout(() => {
            setRecentlyUpdated(prev => {
              const next = new Set(prev)
              next.delete(updated.block_id)
              return next
            })
          }, 4000)
        }
      )
      .subscribe()

    return () => { sb.removeChannel(channel) }
  }, [doc.document_id, sb])

  // ── Save title ───────────────────────────────────────────────────────────
  async function handleTitleBlur() {
    setEditingTitle(false)
    if (titleValue === doc.title) return
    const { data } = await sb
      .from('document')
      .update({ title: titleValue })
      .eq('document_id', doc.document_id)
      .select()
      .single()
    if (data) setDoc(data as Document)
  }

  // ── Save rationale ───────────────────────────────────────────────────────
  async function handleRationaleBlur() {
    const trimmed = rationaleValue.trim()
    const current = doc.rationale ?? ''
    if (trimmed === current) return
    const { data } = await sb
      .from('document')
      .update({ rationale: trimmed || null })
      .eq('document_id', doc.document_id)
      .select()
      .single()
    if (data) setDoc(data as Document)
  }

  // ── Publish ──────────────────────────────────────────────────────────────
  async function handlePublish() {
    if (hasConflicts) return
    setIsPublishing(true)
    const { data } = await sb
      .from('document')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('document_id', doc.document_id)
      .select()
      .single()
    if (data) setDoc(data as Document)
    setIsPublishing(false)
  }

  // ── Add block via MCP (fallback: direct Supabase) ────────────────────────
  async function handleAddBlock() {
    console.log('[handleAddBlock] iniciando, doc_id:', doc.document_id)
    setIsAddingBlock(true)
    try {
      console.log('[handleAddBlock] chamando block_create via MCP…')
      const newBlock = await callMCP<BlockType>('block_create', {
        document_id: doc.document_id,
        content: '',
        position: doc.block_order.length,
      })
      console.log('[handleAddBlock] block_create ok:', newBlock)

      setBlocks(prev =>
        prev.some(b => b.block_id === newBlock.block_id) ? prev : [...prev, newBlock]
      )
      setDoc(d => ({
        ...d,
        block_order: d.block_order.includes(newBlock.block_id)
          ? d.block_order
          : [...d.block_order, newBlock.block_id],
      }))
      setMcpOffline(false)
    } catch (err) {
      console.error('[handleAddBlock] erro:', err)

      if (err instanceof McpOfflineError) {
        handleMcpOffline()
      }

      // Fallback Supabase — cobre tanto MCP offline quanto erros inesperados
      console.log('[handleAddBlock] fallback: insert direto no Supabase')
      try {
        const { data: newBlock, error: sbErr } = await sb
          .from('block')
          .insert({ document_id: doc.document_id, content: '', status: 'draft', version: 1 })
          .select()
          .single()
        if (sbErr) { console.error('[handleAddBlock] Supabase insert erro:', sbErr); return }
        if (!newBlock) { console.error('[handleAddBlock] Supabase não retornou bloco'); return }

        const newOrder = [...doc.block_order, newBlock.block_id]
        const { error: orderErr } = await sb
          .from('document')
          .update({ block_order: newOrder })
          .eq('document_id', doc.document_id)
        if (orderErr) console.error('[handleAddBlock] Supabase update block_order erro:', orderErr)

        setDoc(d => ({ ...d, block_order: newOrder }))
        setBlocks(prev => [...prev, newBlock as BlockType])
        console.log('[handleAddBlock] fallback ok, block_id:', newBlock.block_id)
      } catch (fbErr) {
        console.error('[handleAddBlock] fallback também falhou:', fbErr)
      }
    } finally {
      setIsAddingBlock(false)
    }
  }

  // ── Improve rationale with AI ────────────────────────────────────────────
  async function handleImproveRationale() {
    setIsImprovingRationale(true)
    try {
      const res = await fetch('/api/improve-rationale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: doc.document_id }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Erro ao melhorar o rationale.')
        return
      }
      setRationaleValue(json.rationale)
      // Salva imediatamente — PM ainda pode editar e o blur salva novamente se mudar
      const { data } = await sb
        .from('document')
        .update({ rationale: json.rationale })
        .eq('document_id', doc.document_id)
        .select()
        .single()
      if (data) setDoc(data as Document)
    } catch (err) {
      console.error('[handleImproveRationale]', err)
      alert('Erro ao conectar com a API.')
    } finally {
      setIsImprovingRationale(false)
    }
  }

  // ── Block callbacks ──────────────────────────────────────────────────────
  const handleBlockChange = useCallback((updated: BlockType) => {
    setBlocks(prev => prev.map(b => b.block_id === updated.block_id ? updated : b))
  }, [])

  const handleSelect = useCallback((_blockId: string, history: BlockVersion[]) => {
    setSelectedHistory(history)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* MCP offline banner */}
      {mcpOffline && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-2 flex items-center gap-2 text-xs text-yellow-800">
          <span>⚡</span>
          <span>
            Servidor MCP offline — embeddings e detecção de conflitos desativados.
            Salvamentos continuam funcionando diretamente no banco.
          </span>
          <button
            onClick={() => setMcpOffline(false)}
            className="ml-auto text-yellow-600 hover:text-yellow-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* Topbar */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => { router.refresh(); router.push('/') }}
          className="text-gray-400 hover:text-gray-700 text-sm transition"
        >
          ← Voltar
        </button>

        <div className="flex flex-col min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={e => e.key === 'Enter' && handleTitleBlur()}
              className="text-lg font-semibold text-gray-900 bg-transparent border-b border-indigo-400 outline-none px-0"
            />
          ) : (
            <h1
              className="text-lg font-semibold text-gray-900 truncate cursor-pointer hover:text-indigo-600 transition"
              onClick={() => setEditingTitle(true)}
              title="Clique para editar"
            >
              {doc.title}
            </h1>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <StatusPill value={doc.doc_type} />
            <StatusPill value={doc.status} />
            <span>·</span>
            <span>
              atualizado{' '}
              {formatDistanceToNow(new Date(doc.updated_at), { addSuffix: true, locale: ptBR })}
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <DeleteDocumentButton
            documentId={doc.document_id}
            documentTitle={doc.title}
            blockCount={blocks.length}
          />

          <button
            onClick={handlePublish}
            disabled={hasConflicts || doc.status === 'approved' || isPublishing}
            title={hasConflicts ? 'Resolva todos os conflitos antes de publicar' : ''}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition ${
              hasConflicts || doc.status === 'approved'
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isPublishing ? 'Publicando…' : doc.status === 'approved' ? '✓ Publicado' : 'Publicar no KB'}
          </button>
        </div>
      </header>

      {/* Rationale bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-3">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-xs font-medium text-gray-400">Motivação</p>
          <button
            onClick={handleImproveRationale}
            disabled={isImprovingRationale}
            title="Melhorar com IA"
            className="p-0.5 rounded text-gray-300 hover:text-indigo-500 disabled:opacity-40 transition"
          >
            {isImprovingRationale ? (
              <span className="text-[11px] text-indigo-400 animate-pulse">gerando…</span>
            ) : (
              <span className="text-xs">✨</span>
            )}
          </button>
        </div>
        <textarea
          value={rationaleValue}
          onChange={e => setRationaleValue(e.target.value)}
          onBlur={handleRationaleBlur}
          rows={2}
          disabled={isImprovingRationale}
          placeholder="Descreva o racional deste documento…"
          className="w-full text-sm text-gray-700 placeholder-gray-300 bg-transparent resize-none focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-6 max-w-6xl mx-auto w-full px-6 py-6">
        {/* Block list */}
        <main className="flex-1 flex flex-col gap-3 min-w-0">
          {orderedBlocks.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-16">
              Nenhum bloco ainda. Clique em &ldquo;Adicionar bloco&rdquo; para começar.
            </div>
          )}

          {orderedBlocks.map((block, i) => (
            <Block
              key={block.block_id}
              block={block}
              index={i}
              relations={relations.filter(r => r.source_block_id === block.block_id)}
              relatedTitles={relatedTitles}
              isRecentlyUpdated={recentlyUpdated.has(block.block_id)}
              mcpOffline={mcpOffline}
              onMcpOffline={handleMcpOffline}
              onSelect={handleSelect}
              onBlockChange={handleBlockChange}
            />
          ))}

          <button
            onClick={handleAddBlock}
            disabled={isAddingBlock}
            className="mt-2 flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 text-sm font-medium transition disabled:opacity-50"
          >
            {isAddingBlock ? 'Criando bloco…' : '+ Adicionar bloco'}
          </button>
        </main>

        {/* Sidebar */}
        <BlockMetadata
          relations={relations}
          history={selectedHistory}
          totalBlocks={blocks.length}
          conflictCount={conflictCount}
          frozenCount={frozenCount}
          docType={doc.doc_type}
          docStatus={doc.status}
        />
      </div>
    </div>
  )
}
