import type { BlockStatus, DocStatus, ChangeSource, RelationType, RelationOrigin } from '@/lib/types'

type AnyStatus = BlockStatus | DocStatus | ChangeSource | RelationType | RelationOrigin | string

const VARIANTS: Record<string, string> = {
  // doc / block status
  draft:        'bg-amber-100 text-amber-800',
  approved:     'bg-green-100 text-green-800',
  conflict:     'bg-red-100 text-red-800',
  frozen:       'bg-blue-100 text-blue-800',
  deprecated:   'bg-gray-100 text-gray-400 line-through',
  // change source
  human:        'bg-violet-100 text-violet-800',
  agent:        'bg-cyan-100 text-cyan-800',
  mcp:          'bg-gray-100 text-gray-700',
  // relation type
  conflicts:    'bg-red-100 text-red-800',
  depends_on:   'bg-orange-100 text-orange-800',
  evolves_from: 'bg-indigo-100 text-indigo-800',
  similar:      'bg-sky-100 text-sky-800',
  // relation origin
  structural:   'bg-gray-100 text-gray-700',
  inferred:     'bg-purple-100 text-purple-800',
  // doc type
  prd:          'bg-teal-100 text-teal-800',
  policy:       'bg-yellow-100 text-yellow-800',
  contract:     'bg-pink-100 text-pink-800',
  runbook:      'bg-lime-100 text-lime-800',
}

export default function StatusPill({ value, className = '' }: { value: AnyStatus; className?: string }) {
  const cls = VARIANTS[value] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls} ${className}`}>
      {value}
    </span>
  )
}
