import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRecommendations, getRecommendationsDiagnostics } from '@/lib/recommendations'
import { addToQueue, createPlaylist, replacePlaylistTracks, addTracksToPlaylist } from '@/lib/spotify'
import { redis } from '@/lib/kv'

const PLAYLIST_NAME = '🔀 Descubrir Ahora'
const PLAYLIST_KEY = (userId: string) => `user:${userId}:discoverPlaylistId`

async function ensurePlaylist(userId: string): Promise<string> {
  const playlistId = await createPlaylist(userId, '', PLAYLIST_NAME)
  await redis.set(PLAYLIST_KEY(userId), playlistId)
  return playlistId
}

async function updatePlaylist(userId: string, uris: string[]): Promise<string> {
  let playlistId = await redis.get<string>(PLAYLIST_KEY(userId))

  if (playlistId) {
    // Try to update existing playlist; if it no longer exists, create a new one
    try {
      await replacePlaylistTracks(userId, playlistId, uris.slice(0, 100))
      if (uris.length > 100) {
        for (let i = 100; i < uris.length; i += 100) {
          await addTracksToPlaylist(userId, playlistId, uris.slice(i, i + 100))
        }
      }
      return playlistId
    } catch {
      // Playlist probably deleted — create fresh
      await redis.del(PLAYLIST_KEY(userId))
      playlistId = null
    }
  }

  // Create new playlist
  playlistId = await ensurePlaylist(userId)
  await replacePlaylistTracks(userId, playlistId, uris.slice(0, 100))
  if (uris.length > 100) {
    for (let i = 100; i < uris.length; i += 100) {
      await addTracksToPlaylist(userId, playlistId, uris.slice(i, i + 100))
    }
  }
  return playlistId
}

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

  // For small counts (≤10), try queue first (instant play)
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

  // Default: playlist (single API call, no timeout risk)
  try {
    const playlistId = await updatePlaylist(session.userId, uris)
    return NextResponse.json({ tracks, queuedCount: 0, method: 'playlist', playlistId })
  } catch (err) {
    return NextResponse.json({ tracks, queuedCount: 0, method: 'tracks_only', error: String(err) }, { status: 500 })
  }
}
