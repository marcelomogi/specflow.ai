'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, DocType, DocumentOrigin } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import { extractText } from '@/lib/extractText'

const OWNER_ID = '00000000-0000-0000-0000-000000000001'

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'prd',      label: 'PRD' },
  { value: 'policy',   label: 'Policy' },
  { value: 'contract', label: 'Contract' },
  { value: 'runbook',  label: 'Runbook' },
]

const ORIGINS: { value: DocumentOrigin; label: string }[] = [
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'oficial',  label: 'Oficial' },
  { value: 'legado',   label: 'Legado' },
]

type Step = 'choose' | 'create' | 'import'

interface Props {
  onClose: () => void
  onDocCreated: (doc: Document) => void
}

export default function NewDocumentModal({ onClose, onDocCreated }: Props) {
  const [step, setStep] = useState<Step>('choose')

  // Shared fields
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState<DocType>('prd')
  const [rationale, setRationale] = useState('')

  // Import-only fields
  const [origin, setOrigin] = useState<DocumentOrigin>('rascunho')
  const [file, setFile] = useState<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const sb = createClient()
  const router = useRouter()

  // ── Create from scratch ──────────────────────────────────────────────────

  async function handleCreate() {
    if (!title.trim()) return
    setBusy(true)
    setStatusMsg('Criando documento…')
    try {
      const { data, error } = await sb
        .from('document')
        .insert({
          title: title.trim(),
          doc_type: docType,
          owner_id: OWNER_ID,
          status: 'draft',
          block_order: [],
          rationale: rationale.trim() || null,
        })
        .select()
        .single()

      if (error) throw new Error(error.message)
      if (!data) throw new Error('Nenhum dado retornado')

      onDocCreated(data as Document)
      router.push(`/documents/${(data as Document).document_id}`)
    } catch (err) {
      setStatusMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(false)
    }
  }

  // ── Import file ──────────────────────────────────────────────────────────

  async function handleImport() {
    if (!title.trim() || !file) return
    setBusy(true)
    setStatusMsg(null)

    try {
      // 1. Create the document record
      setStatusMsg('Criando documento…')
      const { data: doc, error: docErr } = await sb
        .from('document')
        .insert({
          title: title.trim(),
          doc_type: docType,
          owner_id: OWNER_ID,
          status: 'draft',
          block_order: [],
          rationale: rationale.trim() || null,
        })
        .select()
        .single()

      if (docErr) throw new Error(docErr.message)
      if (!doc) throw new Error('Nenhum dado retornado')

      const docId = (doc as Document).document_id

      // 2. Extract text from the file in-browser
      setStatusMsg(`Extraindo texto de "${file.name}"…`)
      const rawText = await extractText(file)
      if (!rawText.trim()) throw new Error('Não foi possível extrair texto do arquivo')

      // 3. Call the API route which forwards to MCP document_ingest
      setStatusMsg('Analisando e criando blocos (LLM)…')
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: docId, raw_text: rawText, origin }),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Falha na ingestão')

      const blocksCreated: number = result.blocks_created ?? 0
      setStatusMsg(`✅ ${blocksCreated} bloco${blocksCreated !== 1 ? 's' : ''} criado${blocksCreated !== 1 ? 's' : ''}`)

      // Brief pause so the user sees the success message before navigation
      await new Promise(r => setTimeout(r, 800))

      onDocCreated(doc as Document)
      router.push(`/documents/${docId}`)
    } catch (err) {
      console.error('[NewDocumentModal] import error:', err)
      setStatusMsg(`Erro: ${err instanceof Error ? err.message : String(err)}`)
      setBusy(false)
    }
  }

  // ── Shared form fields ───────────────────────────────────────────────────

  const sharedFields = (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Título <span className="text-red-400">*</span>
        </label>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && step === 'create') handleCreate()
          }}
          placeholder="Ex: Política de Senhas v2"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
        <select
          value={docType}
          onChange={e => setDocType(e.target.value as DocType)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          {DOC_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {step === 'import'
            ? 'Por que este documento está sendo importado agora?'
            : 'Por que este documento está sendo criado?'}
        </label>
        <textarea
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          rows={3}
          placeholder="Descreva o racional deste documento…"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step !== 'choose' && (
              <button
                onClick={() => { setStep('choose'); setStatusMsg(null) }}
                disabled={busy}
                className="text-gray-400 hover:text-gray-600 text-sm transition disabled:opacity-40"
              >
                ←
              </button>
            )}
            <h2 className="text-base font-semibold text-gray-900">
              {step === 'choose' && 'Novo documento'}
              {step === 'create' && 'Criar do zero'}
              {step === 'import' && 'Importar arquivo'}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-40"
          >
            &times;
          </button>
        </div>

        {/* ── Step: choose ── */}
        {step === 'choose' && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => setStep('create')}
              className="flex items-start gap-3 rounded-xl border-2 border-gray-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/30 transition"
            >
              <span className="text-xl mt-0.5">✏️</span>
              <div>
                <p className="font-medium text-gray-900 text-sm">Criar do zero</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Documento em branco. Blocos adicionados manualmente ou pelo agente.
                </p>
              </div>
            </button>

            <button
              onClick={() => setStep('import')}
              className="flex items-start gap-3 rounded-xl border-2 border-gray-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/30 transition"
            >
              <span className="text-xl mt-0.5">📄</span>
              <div>
                <p className="font-medium text-gray-900 text-sm">Importar arquivo</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Envie um PDF, DOCX ou MD. O agente identifica e cria os blocos automaticamente.
                </p>
              </div>
            </button>
          </div>
        )}

        {/* ── Step: create ── */}
        {step === 'create' && (
          <>
            {sharedFields}
            {statusMsg && (
              <p className={`text-xs ${statusMsg.startsWith('Erro') ? 'text-red-600' : 'text-gray-500'}`}>
                {statusMsg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg border border-gray-200 hover:border-gray-300 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={!title.trim() || busy}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {busy ? 'Criando…' : 'Criar documento'}
              </button>
            </div>
          </>
        )}

        {/* ── Step: import ── */}
        {step === 'import' && (
          <>
            {sharedFields}

            {/* Origin */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Origem do documento</label>
              <select
                value={origin}
                onChange={e => setOrigin(e.target.value as DocumentOrigin)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {ORIGINS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* File picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Arquivo <span className="text-red-400">*</span>
              </label>
              <div
                onClick={() => fileRef.current?.click()}
                className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 cursor-pointer transition ${
                  file
                    ? 'border-indigo-300 bg-indigo-50/30 text-indigo-700'
                    : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/20 text-gray-400'
                }`}
              >
                <span>{file ? '📎' : '⬆️'}</span>
                <span className="text-sm">
                  {file ? file.name : 'Clique para selecionar PDF, DOCX ou MD'}
                </span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.md,.txt"
                className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* Status message */}
            {statusMsg && (
              <p className={`text-xs ${statusMsg.startsWith('Erro') ? 'text-red-600' : 'text-gray-500 animate-pulse'}`}>
                {statusMsg}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg border border-gray-200 hover:border-gray-300 transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={!title.trim() || !file || busy}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {busy ? 'Importando…' : 'Importar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
