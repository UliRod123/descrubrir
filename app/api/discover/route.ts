import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRecommendations, getRecommendationsDiagnostics } from '@/lib/recommendations'
import { addToQueue, createPlaylist, replacePlaylistTracks, addTracksToPlaylist, getCurrentUserId } from '@/lib/spotify'
import { redis } from '@/lib/kv'

const PLAYLIST_NAME = '🔀 Descubrir Ahora'
const PLAYLIST_KEY = (userId: string) => `user:${userId}:discoverPlaylistId`

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
    const diag = await getRecommendationsDiagnostics(session.userId).catch(e => ({ diagError: String(e) }))
    return NextResponse.json({ tracks: [], queuedCount: 0, method: 'none', diagnostics: diag })
  }

  const uris = tracks.map(t => t.uri)

  // Strategy 1: if count is small (≤10), try adding to queue (instant play)
  if (count <= 10) {
    let queuedCount = 0
    let queueFailed = false
    for (const uri of uris) {
      try {
        await addToQueue(session.userId, uri)
        queuedCount++
      } catch {
        queueFailed = true
        break
      }
    }
    if (!queueFailed && queuedCount > 0) {
      return NextResponse.json({ tracks, queuedCount, method: 'queue' })
    }
  }

  // Strategy 2 (default for large counts): update playlist — single API call, no timeout risk
  try {
    let playlistId = await redis.get<string>(PLAYLIST_KEY(session.userId))

    if (!playlistId) {
      const spotifyUserId = await getCurrentUserId(session.userId)
      playlistId = await createPlaylist(session.userId, spotifyUserId, PLAYLIST_NAME)
      await redis.set(PLAYLIST_KEY(session.userId), playlistId)
    }

    // Spotify allows max 100 URIs per PUT — for larger batches use POST to add
    if (uris.length <= 100) {
      await replacePlaylistTracks(session.userId, playlistId, uris)
    } else {
      await replacePlaylistTracks(session.userId, playlistId, uris.slice(0, 100))
      // Add remaining in chunks of 100
      for (let i = 100; i < uris.length; i += 100) {
        await addTracksToPlaylist(session.userId, playlistId, uris.slice(i, i + 100))
      }
    }

    return NextResponse.json({ tracks, queuedCount: 0, method: 'playlist', playlistId })
  } catch (err) {
    return NextResponse.json({ tracks, queuedCount: 0, method: 'tracks_only', error: String(err) })
  }
}
