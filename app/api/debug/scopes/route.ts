import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { redis } from '@/lib/kv'
import { spotifyFetch } from '@/lib/spotify'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const savedScopes = await redis.get<string>(`user:${session.userId}:scopes`)

  // Try a write operation directly to see the real error
  const writeTest = await spotifyFetch(session.userId, '/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name: 'test-scope-check', public: false, description: 'test' }),
  })
    .then((data) => ({ ok: true, playlistId: (data as { id: string }).id }))
    .catch((e) => ({ ok: false, error: String(e) }))

  // Clean up test playlist if created
  if ((writeTest as { ok: boolean; playlistId?: string }).ok) {
    const pid = (writeTest as { playlistId: string }).playlistId
    await spotifyFetch(session.userId, `/playlists/${pid}/followers`, { method: 'DELETE' }).catch(() => {})
  }

  return NextResponse.json({
    userId: session.userId,
    savedScopes,
    writeTest,
  })
}
