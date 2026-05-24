import { NextRequest, NextResponse } from 'next/server'
import { MOCK_USERS, OWNER_COOKIE } from '@/lib/users'

export function GET(req: NextRequest) {
  const ownerId = req.nextUrl.searchParams.get('owner_id') ?? ''
  const isValid = MOCK_USERS.some(u => u.id === ownerId)

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid owner_id' }, { status: 400 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(OWNER_COOKIE, ownerId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 1 week
  })
  return response
}
