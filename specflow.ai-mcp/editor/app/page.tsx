import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { Document } from '@/lib/types'
import DocumentList from '@/components/DocumentList'

export const revalidate = 0

export default async function Home() {
  const sb = createServerSupabaseClient()

  const { data } = await sb
    .from('document')
    .select('*')
    .order('updated_at', { ascending: false })

  return <DocumentList initial={(data ?? []) as Document[]} />
}
