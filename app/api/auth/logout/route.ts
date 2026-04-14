import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  const cookieStore = await cookies()
  cookieStore.delete('session')
  return NextResponse.redirect(new URL('/', process.env.SPOTIFY_REDIRECT_URI!.replace('/api/auth/callback', '')))
}
