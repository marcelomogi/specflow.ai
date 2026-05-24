'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Document } from '@/lib/types'
import { createClient } from '@/lib/supabase'
import { findUser } from '@/lib/users'
import StatusPill from './StatusPill'
import NewDocumentModal from './NewDocumentModal'

export default function DocumentList({ initial, ownerId }: { initial: Document[]; ownerId: string }) {
  const currentUser = findUser(ownerId)
  const [docs, setDocs] = useState(initial)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Document | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()
  const sb = createClient()

  function handleDocCreated(doc: Document) {
    setDocs(prev => [doc, ...prev.filter(d => d.document_id !== doc.document_id)])
    setShowModal(false)
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setIsDeleting(true)
    try {
      await sb.from('document').delete().eq('document_id', confirmDelete.document_id)
      setDocs(prev => prev.filter(d => d.document_id !== confirmDelete.document_id))
    } catch (err) {
      console.error('[DocumentList] erro ao deletar:', err)
    } finally {
      setIsDeleting(false)
      setConfirmDelete(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">SpecFlowIA</h1>
          <p className="text-sm text-gray-500">Documentos corporativos</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Current user badge */}
          {currentUser && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
              <span className="text-base">{currentUser.emoji}</span>
              <span className="text-sm font-medium text-gray-700">{currentUser.name}</span>
              <button
                onClick={() => router.push('/')}
                title="Trocar usuário"
                className="text-xs text-gray-400 hover:text-indigo-600 transition ml-1"
              >
                trocar
              </button>
            </div>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
          >
            + Novo documento
          </button>
        </div>
      </header>

      {/* List */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {docs.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-24">
            Nenhum documento ainda. Crie o primeiro!
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.map(doc => (
              <li key={doc.document_id} className="relative group">
                <button
                  onClick={() => router.push(`/documents/${doc.document_id}`)}
                  className="w-full text-left bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{doc.title}</p>
                    {doc.rationale && (
                      <p className="text-xs text-gray-400 truncate mt-0.5 italic">
                        {doc.rationale}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <StatusPill value={doc.doc_type} />
                      <StatusPill value={doc.status} />
                      <span className="text-xs text-gray-400">
                        {doc.block_order?.length ?? 0} bloco{(doc.block_order?.length ?? 0) !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {formatDistanceToNow(new Date(doc.updated_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </button>

                {/* Botão deletar — aparece no hover do item */}
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(doc) }}
                  title="Deletar documento"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                >
                  🗑️
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {showModal && (
        <NewDocumentModal
          ownerId={ownerId}
          onClose={() => setShowModal(false)}
          onDocCreated={handleDocCreated}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">⚠️</span>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Deletar documento?</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Tem certeza? Esta ação remove{' '}
                  <span className="font-medium text-gray-700">&ldquo;{confirmDelete.title}&rdquo;</span>{' '}
                  e todos os{' '}
                  <span className="font-medium text-gray-700">
                    {confirmDelete.block_order?.length ?? 0} bloco{(confirmDelete.block_order?.length ?? 0) !== 1 ? 's' : ''}
                  </span>{' '}
                  permanentemente e não pode ser desfeita.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 transition"
              >
                {isDeleting ? 'Deletando…' : 'Sim, deletar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
