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

async function writeTracks(userId: string, playlistId: string, uris: string[]): Promise<void> {
  // Replace first batch (clears playlist), then append the rest
  await replacePlaylistTracks(userId, playlistId, uris.slice(0, 100))
  for (let i = 100; i < uris.length; i += 100) {
    await addTracksToPlaylist(userId, playlistId, uris.slice(i, i + 100))
  }
}

async function updatePlaylist(userId: string, uris: string[]): Promise<string> {
  // Always create a fresh playlist so we don't accumulate tracks from previous runs
  // (PUT /replace is restricted for new Spotify apps; POST /add is not)
  await redis.del(PLAYLIST_KEY(userId))
  const playlistId = await ensurePlaylist(userId)
  await writeTracks(userId, playlistId, uris)
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

  // Sanitize URIs — only valid spotify:track:xxx format
  const validUris = uris.filter(u => u && u.startsWith('spotify:track:'))
  if (validUris.length === 0) {
    return NextResponse.json({ tracks, queuedCount: 0, method: 'none', error: 'No valid track URIs' })
  }

  // Default: playlist (single API call, no timeout risk)
  try {
    const playlistId = await updatePlaylist(session.userId, validUris)
    return NextResponse.json({ tracks, queuedCount: 0, method: 'playlist', playlistId })
  } catch (err) {
    return NextResponse.json({ tracks, queuedCount: 0, method: 'tracks_only', error: String(err) }, { status: 500 })
  }
}
