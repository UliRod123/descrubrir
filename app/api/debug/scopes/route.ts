import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { redis } from '@/lib/kv'
import { spotifyFetch } from '@/lib/spotify'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const savedScopes = await redis.get<string>(`user:${session.userId}:scopes`)

  // Step 1: create a test playlist
  const createTest = await spotifyFetch<{ id: string }>(session.userId, '/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name: 'test-debug', public: false, description: 'test' }),
  }).then(d => ({ ok: true, playlistId: d.id })).catch(e => ({ ok: false, error: String(e) }))

  // Step 2: add a real track to it (using a known Spotify track URI)
  let addTracksTest: unknown = 'skipped'
  if ((createTest as { ok: boolean }).ok) {
    const pid = (createTest as { playlistId: string }).playlistId
    addTracksTest = await spotifyFetch(session.userId, `/playlists/${pid}/tracks`, {
      method: 'PUT',
      body: JSON.stringify({ uris: ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh'] }), // known valid URI (Mr. Brightside)
    }).then(() => ({ ok: true })).catch(e => ({ ok: false, error: String(e) }))

    // Clean up
    await spotifyFetch(session.userId, `/playlists/${pid}/followers`, { method: 'DELETE' }).catch(() => {})
  }

  return NextResponse.json({ userId: session.userId, savedScopes, createTest, addTracksTest })
}
