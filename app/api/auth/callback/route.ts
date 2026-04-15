import { NextRequest, NextResponse } from 'next/server'
import { saveTokens } from '@/lib/kv'
import { buildSessionCookieHeader } from '@/lib/session'
import { getCurrentUserId } from '@/lib/spotify'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/?error=no_code', req.url))

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    }),
  })

  if (!res.ok) return NextResponse.redirect(new URL('/?error=token_exchange', req.url))

  const data = await res.json()

  // Use a temp key to call /me and get the real Spotify user ID
  const tempId = `temp_${Date.now()}`
  await saveTokens(tempId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  })

  const spotifyUserId = await getCurrentUserId(tempId)

  await saveTokens(spotifyUserId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  })

  // Save granted scopes for debugging
  const { redis } = await import('@/lib/kv')
  await redis.set(`user:${spotifyUserId}:scopes`, data.scope ?? 'none', { ex: 60 * 60 * 24 * 30 })

  const response = NextResponse.redirect(new URL('/dashboard', req.url))
  response.headers.append('Set-Cookie', buildSessionCookieHeader({ userId: spotifyUserId }))
  return response
}
