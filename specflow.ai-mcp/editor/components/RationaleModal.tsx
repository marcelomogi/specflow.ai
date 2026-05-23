'use client'

import { useState } from 'react'

interface Props {
  blockContent: string
  onClose: () => void
}

export default function RationaleModal({ blockContent, onClose }: Props) {
  const [instruction, setInstruction] = useState('')
  const [copied, setCopied] = useState(false)

  function buildPrompt() {
    return `Revise o seguinte bloco de documento:\n\n---\n${blockContent}\n---\n\nInstrução: ${instruction || '(sem instrução adicional)'}`
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildPrompt())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Solicitar revisão ao agente</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <p className="text-sm text-gray-500">
          Descreva o que o agente deve fazer com este bloco. O prompt formatado será copiado para a área de transferência — cole no chat do Claude.
        </p>

        <textarea
          className="w-full rounded-lg border border-gray-200 text-sm p-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 h-28"
          placeholder="Ex: Torne a linguagem mais formal e reduza para 2 parágrafos..."
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          autoFocus
        />

        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto border border-gray-100">
          {buildPrompt()}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg border border-gray-200 hover:border-gray-300 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleCopy}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            {copied ? '✓ Copiado!' : 'Copiar prompt'}
          </button>
        </div>
      </div>
    </div>
  )
}
