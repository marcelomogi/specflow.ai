import { NextRequest, NextResponse } from 'next/server'
import { MOCK_USERS, OWNER_COOKIE } from '@/lib/users'

export function GET(req: NextRequest) {
  const ownerId = req.nextUrl.searchParams.get('owner_id') ?? ''
  const isValid = MOCK_USERS.some(u => u.id === ownerId)

  if (!isValid) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  const response = NextResponse.redirect(new URL('/documents', req.url))
  response.cookies.set(OWNER_COOKIE, ownerId, {
    httpOnly: false,  // client components can read it too
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 1 week
  })
  return response
}
