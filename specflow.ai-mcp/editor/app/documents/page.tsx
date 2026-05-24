import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import type { Document } from '@/lib/types'
import { OWNER_COOKIE, findUser } from '@/lib/users'
import DocumentList from '@/components/DocumentList'

export const revalidate = 0

export default async function DocumentsPage() {
  const cookieStore = await cookies()
  const ownerId = cookieStore.get(OWNER_COOKIE)?.value

  if (!ownerId || !findUser(ownerId)) {
    redirect('/')
  }

  const sb = createServerSupabaseClient()
  const { data } = await sb
    .from('document')
    .select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })

  return (
    <DocumentList
      initial={(data ?? []) as Document[]}
      ownerId={ownerId}
    />
  )
}
