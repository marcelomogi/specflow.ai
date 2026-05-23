'use client'

import type { BlockRelation, BlockVersion } from '@/lib/types'
import StatusPill from './StatusPill'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Props {
  relations: BlockRelation[]
  history: BlockVersion[]
  totalBlocks: number
  conflictCount: number
  frozenCount: number
  docType: string
  docStatus: string
}

export default function BlockMetadata({
  relations,
  history,
  totalBlocks,
  conflictCount,
  frozenCount,
  docType,
  docStatus,
}: Props) {
  return (
    <aside className="w-72 shrink-0 flex flex-col gap-6">
      {/* Resumo do documento */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documento</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill value={docType} />
          <StatusPill value={docStatus} />
        </div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500">Blocos</dt>
          <dd className="font-medium text-right">{totalBlocks}</dd>
          <dt className="text-gray-500">Conflitos</dt>
          <dd className={`font-medium text-right ${conflictCount > 0 ? 'text-red-600' : 'text-gray-700'}`}>
            {conflictCount}
          </dd>
          <dt className="text-gray-500">Congelados</dt>
          <dd className="font-medium text-right text-blue-600">{frozenCount}</dd>
        </dl>
      </section>

      {/* Relações */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Relações</h3>
        {relations.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Nenhuma relação detectada</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {relations.map(r => (
              <li key={r.relation_id} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusPill value={r.relation_type} />
                  <StatusPill value={r.origin} />
                  {r.confidence !== null && (
                    <span className="text-xs text-gray-400">{Math.round(r.confidence * 100)}%</span>
                  )}
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{r.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Histórico do bloco selecionado */}
      <section className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico do bloco</h3>
        {history.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Selecione um bloco para ver o histórico</p>
        ) : (
          <ul className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
            {history.map(v => (
              <li key={v.version_id} className="flex flex-col gap-1 border-l-2 border-gray-100 pl-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-700">v{v.version_number}</span>
                  <StatusPill value={v.change_source} />
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{v.content}</p>
                <span className="text-[11px] text-gray-400">
                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true, locale: ptBR })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
