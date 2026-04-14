import { NextRequest, NextResponse } from 'next/server'
import { getRecommendations } from '@/lib/recommendations'
import { createPlaylist, replacePlaylistTracks, getCurrentUserId } from '@/lib/spotify'
import { getPlaylistId, savePlaylistId, getAllUserIds } from '@/lib/kv'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userIds = await getAllUserIds()
  const results = []

  for (const userId of userIds) {
    try {
      const tracks = await getRecommendations(userId, 30)
      const uris = tracks.map((t) => t.uri)

      let playlistId = await getPlaylistId(userId)
      if (!playlistId) {
        const spotifyUserId = await getCurrentUserId(userId)
        playlistId = await createPlaylist(userId, spotifyUserId, '🎵 Discovery Diario')
        await savePlaylistId(userId, playlistId)
      }

      await replacePlaylistTracks(userId, playlistId, uris)
      results.push({ userId, success: true, count: tracks.length })
    } catch (err) {
      results.push({ userId, success: false, error: String(err) })
    }
  }

  return NextResponse.json({ results })
}
