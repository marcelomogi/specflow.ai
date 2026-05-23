export type BlockStatus = 'draft' | 'frozen' | 'approved' | 'conflict' | 'deprecated'
export type DocStatus = 'draft' | 'approved'
export type DocType = 'prd' | 'policy' | 'contract' | 'runbook'
export type DocumentOrigin = 'oficial' | 'rascunho' | 'legado'
export type ChangeSource = 'human' | 'agent' | 'mcp'
export type RelationType = 'conflict' | 'depends_on' | 'evolves_from' | 'similar'
export type RelationOrigin = 'structural' | 'inferred'

export interface Document {
  document_id: string
  title: string
  doc_type: DocType
  status: DocStatus
  block_order: string[]
  section_map: Record<string, string[]>
  owner_id: string
  rationale: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface Block {
  block_id: string
  document_id: string
  content: string
  status: BlockStatus
  rationale: string | null
  frozen_by: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface BlockVersion {
  version_id: string
  block_id: string
  content: string
  rationale: string | null
  changed_by: string
  change_source: ChangeSource
  version_number: number
  created_at: string
}

export interface BlockRelation {
  relation_id: string
  source_block_id: string
  target_block_id: string
  relation_type: RelationType
  origin: RelationOrigin
  confidence: number | null
  description: string
  created_at: string
}
