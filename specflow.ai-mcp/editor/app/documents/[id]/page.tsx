import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { Document, Block, BlockRelation } from '@/lib/types'
import DocumentEditor from '@/components/DocumentEditor'

export const revalidate = 0

interface Props {
  params: Promise<{ id: string }>
}

export default async function DocumentPage({ params }: Props) {
  const { id } = await params
  const sb = createServerSupabaseClient()

  const { data: doc } = await sb
    .from('document')
    .select('*')
    .eq('document_id', id)
    .single()

  if (!doc) notFound()

  const document = doc as Document
  const blockOrder: string[] = document.block_order ?? []

  // Fetch blocks
  let blocks: Block[] = []
  if (blockOrder.length > 0) {
    const { data: rawBlocks } = await sb
      .from('block')
      .select('*')
      .in('block_id', blockOrder)

    const blockMap = new Map((rawBlocks ?? []).map(b => [b.block_id as string, b as Block]))
    blocks = blockOrder.map(id => blockMap.get(id)).filter((b): b is Block => !!b)
  }

  // Fetch relations
  let relations: BlockRelation[] = []
  if (blockOrder.length > 0) {
    const { data: rel } = await sb
      .from('block_relation')
      .select('*')
      .in('source_block_id', blockOrder)
    relations = (rel ?? []) as BlockRelation[]
  }

  return (
    <DocumentEditor
      initialDoc={document}
      initialBlocks={blocks}
      initialRelations={relations}
    />
  )
}
