import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getTopTracks, getTopArtistsFull, searchTracks, getRecentlyPlayedTrackIds } from '@/lib/spotify'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.userId
  const result: Record<string, unknown> = { userId }

  // Step 1: top tracks all ranges
  const [tracksShort, tracksMedium, tracksLong] = await Promise.all([
    getTopTracks(userId, 'short_term', 50).catch(e => ({ error: String(e) })),
    getTopTracks(userId, 'medium_term', 50).catch(e => ({ error: String(e) })),
    getTopTracks(userId, 'long_term', 50).catch(e => ({ error: String(e) })),
  ])
  result.step1_topTracks = {
    short: Array.isArray(tracksShort) ? `${tracksShort.length} tracks, sample: ${tracksShort.slice(0,2).map(t=>t.name).join(', ')}` : tracksShort,
    medium: Array.isArray(tracksMedium) ? `${tracksMedium.length} tracks` : tracksMedium,
    long: Array.isArray(tracksLong) ? `${tracksLong.length} tracks` : tracksLong,
  }

  // Step 2: artists with genres
  const artists = await getTopArtistsFull(userId, 'medium_term', 20).catch(e => ({ error: String(e) }))
  const genres = Array.isArray(artists)
    ? Array.from(new Set(artists.flatMap(a => a.genres ?? []))).slice(0, 8)
    : []
  result.step2_artists = Array.isArray(artists)
    ? { count: artists.length, sample: artists.slice(0,5).map(a=>a.name), genres }
    : artists

  // Step 3: recently played
  const recentIds = await getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>())
  result.step3_recentIds = recentIds.size

  // Step 4: search test
  if (genres.length > 0) {
    const searchTest = await searchTracks(userId, `genre:"${genres[0]}"`, 5)
      .then(t => ({ ok: true, genre: genres[0], count: t.length, sample: t.map(x=>`${x.name} - ${x.artists[0]?.name}`) }))
      .catch(e => ({ ok: false, error: String(e) }))
    result.step4_searchTest = searchTest
  } else {
    result.step4_searchTest = 'skipped - no genres found'
  }

  return NextResponse.json(result)
}
