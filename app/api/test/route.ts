import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getTopTracks, getTopArtistsFull, searchTracks, getRecentlyPlayedTrackIds } from '@/lib/spotify'
import { filterOutRecommended } from '@/lib/kv'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.userId
  const result: Record<string, unknown> = { userId }

  const [tracksShort, tracksMedium, tracksLong, artists, recentIds] = await Promise.all([
    getTopTracks(userId, 'short_term', 50).catch(e => ({ error: String(e) })),
    getTopTracks(userId, 'medium_term', 50).catch(e => ({ error: String(e) })),
    getTopTracks(userId, 'long_term', 50).catch(e => ({ error: String(e) })),
    getTopArtistsFull(userId, 'medium_term', 20).catch(e => ({ error: String(e) })),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  const totalTracks = new Map()
  for (const t of [
    ...(Array.isArray(tracksShort) ? tracksShort : []),
    ...(Array.isArray(tracksMedium) ? tracksMedium : []),
    ...(Array.isArray(tracksLong) ? tracksLong : []),
  ]) { if (t.id) totalTracks.set(t.id, t) }

  const poolARaw = Array.from(totalTracks.values()).filter((t: {id:string}) => !recentIds.has(t.id))
  const poolAFiltered = await filterOutRecommended(userId, poolARaw.map((t: {id:string}) => t.id))

  result.poolA = {
    totalUnique: totalTracks.size,
    afterRecentFilter: poolARaw.length,
    afterHistoryFilter: poolAFiltered.length,
    recentIds: recentIds.size,
  }

  // Test search with first artist
  const firstArtist = Array.isArray(artists) ? artists[0] : null
  if (firstArtist) {
    const searchResult = await searchTracks(userId, `artist:"${firstArtist.name}"`, 10)
      .then(t => ({ ok: true, artist: firstArtist.name, count: t.length, sample: t.slice(0,3).map(x => `${x.name} — ${x.artists[0]?.name}`) }))
      .catch(e => ({ ok: false, error: String(e) }))
    result.poolB_searchTest = searchResult
  }

  return NextResponse.json(result)
}
