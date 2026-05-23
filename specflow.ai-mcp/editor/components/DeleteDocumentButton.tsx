'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface Props {
  documentId: string
  documentTitle: string
  blockCount: number
}

export default function DeleteDocumentButton({ documentId, documentTitle, blockCount }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()
  const sb = createClient()

  async function handleDelete() {
    setIsDeleting(true)
    try {
      await sb.from('document').delete().eq('document_id', documentId)
      router.push('/')
    } catch (err) {
      console.error('[DeleteDocumentButton] erro ao deletar:', err)
      setIsDeleting(false)
      setShowConfirm(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        title="Deletar documento"
        className="p-1.5 rounded-lg text-sm text-gray-400 hover:bg-red-50 hover:text-red-500 transition"
      >
        🗑️
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">⚠️</span>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Deletar documento?</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Tem certeza? Esta ação remove{' '}
                  <span className="font-medium text-gray-700">&ldquo;{documentTitle}&rdquo;</span>{' '}
                  e todos os{' '}
                  <span className="font-medium text-gray-700">
                    {blockCount} bloco{blockCount !== 1 ? 's' : ''}
                  </span>{' '}
                  permanentemente e não pode ser desfeita.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirm(false)}
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
    </>
  )
}
