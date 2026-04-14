import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRecommendations, getRecommendationsDiagnostics } from '@/lib/recommendations'
import { addToQueue, createPlaylist, replacePlaylistTracks, getCurrentUserId } from '@/lib/spotify'
import { redis } from '@/lib/kv'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = Math.min(
    parseInt(req.nextUrl.searchParams.get('count') ?? '10', 10),
    100
  )

  let tracks
  try {
    tracks = await getRecommendations(session.userId, count, true)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  if (tracks.length === 0) {
    // Run diagnostics to understand why
    const diag = await getRecommendationsDiagnostics(session.userId).catch((e) => ({ diagError: String(e) }))
    return NextResponse.json({ tracks: [], queuedCount: 0, method: 'none', diagnostics: diag })
  }

  // Try adding to queue first (requires Premium)
  let queuedCount = 0
  let queueFailed = false
  for (const track of tracks) {
    try {
      await addToQueue(session.userId, track.uri)
      queuedCount++
    } catch {
      queueFailed = true
      break
    }
  }

  // If queue fails (Free account), fall back to updating the Discovery playlist
  if (queueFailed || queuedCount === 0) {
    try {
      let playlistId = await redis.get<string>(`user:${session.userId}:discoverPlaylistId`)
      if (!playlistId) {
        const spotifyUserId = await getCurrentUserId(session.userId)
        playlistId = await createPlaylist(session.userId, spotifyUserId, '🔀 Descubrir Ahora')
        await redis.set(`user:${session.userId}:discoverPlaylistId`, playlistId)
      }
      await replacePlaylistTracks(session.userId, playlistId, tracks.map((t) => t.uri))
      return NextResponse.json({ tracks, queuedCount: 0, method: 'playlist', playlistId })
    } catch (err) {
      return NextResponse.json({ tracks, queuedCount: 0, method: 'tracks_only', error: String(err) })
    }
  }

  return NextResponse.json({ tracks, queuedCount, method: 'queue' })
}
