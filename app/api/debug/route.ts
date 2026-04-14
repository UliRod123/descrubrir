import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { spotifyFetch } from '@/lib/spotify'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [short, medium, longTerm, recent, devices] = await Promise.all([
      spotifyFetch<{ items: { id: string; name: string }[] }>(session.userId, '/me/top/artists?time_range=short_term&limit=5').catch(e => ({ error: String(e) })),
      spotifyFetch<{ items: { id: string; name: string }[] }>(session.userId, '/me/top/artists?time_range=medium_term&limit=5').catch(e => ({ error: String(e) })),
      spotifyFetch<{ items: { id: string; name: string }[] }>(session.userId, '/me/top/artists?time_range=long_term&limit=5').catch(e => ({ error: String(e) })),
      spotifyFetch<{ items: unknown[] }>(session.userId, '/me/player/recently-played?limit=5').catch(e => ({ error: String(e) })),
      spotifyFetch<{ devices: { name: string; is_active: boolean }[] }>(session.userId, '/me/player/devices').catch(e => ({ error: String(e) })),
    ])

    return NextResponse.json({ userId: session.userId, short, medium, longTerm, recent, devices })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
