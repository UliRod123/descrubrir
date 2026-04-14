import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getTopArtists, getRecentlyPlayedTrackIds, getArtistTopTracks, getRelatedArtists } from '@/lib/spotify'
import { filterOutRecommended } from '@/lib/kv'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.userId
  const result: Record<string, unknown> = { userId }

  // Step 1: Get artists
  const [shortArtists, mediumArtists, longArtists] = await Promise.all([
    getTopArtists(userId, 'short_term').catch((e) => ({ error: String(e) })),
    getTopArtists(userId, 'medium_term').catch((e) => ({ error: String(e) })),
    getTopArtists(userId, 'long_term').catch((e) => ({ error: String(e) })),
  ])
  result.step1_artists = {
    short: Array.isArray(shortArtists) ? shortArtists.map(a => a.name) : shortArtists,
    medium: Array.isArray(mediumArtists) ? mediumArtists.map(a => a.name) : mediumArtists,
    long: Array.isArray(longArtists) ? longArtists.map(a => a.name) : longArtists,
  }

  const artistList = [
    ...(Array.isArray(shortArtists) ? shortArtists : []),
    ...(Array.isArray(mediumArtists) ? mediumArtists : []),
    ...(Array.isArray(longArtists) ? longArtists : []),
  ]
  const artistMap = new Map(artistList.map(a => [a.id, a]))
  const knownArtists = Array.from(artistMap.values())

  if (knownArtists.length === 0) {
    result.abort = 'No artists found'
    return NextResponse.json(result)
  }

  // Step 2: Recently played
  const recentIds = await getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>())
  result.step2_recentIds = recentIds.size

  // Step 3: Top tracks for first 3 artists
  const testArtists = knownArtists.slice(0, 3)
  const topTracksTests = await Promise.all(
    testArtists.map(a =>
      getArtistTopTracks(userId, a.id)
        .then(tracks => ({ artist: a.name, count: tracks.length, filtered: tracks.filter(t => !recentIds.has(t.id)).length, sample: tracks.slice(0, 2).map(t => t.name) }))
        .catch(e => ({ artist: a.name, error: String(e) }))
    )
  )
  result.step3_topTracks = topTracksTests

  // Step 4: Related artists for first artist
  const relatedTest = await getRelatedArtists(userId, knownArtists[0].id)
    .then(artists => ({ count: artists.length, sample: artists.slice(0, 5).map(a => a.name) }))
    .catch(e => ({ error: String(e) }))
  result.step4_relatedArtists = relatedTest

  // Step 5: Check recommended set size
  const allTrackIds = topTracksTests
    .flatMap(t => ('error' in t ? [] : []))
  const filtered = await filterOutRecommended(userId, ['test']).catch(e => ({ error: String(e) }))
  result.step5_filterTest = filtered

  return NextResponse.json(result, { headers: { 'Content-Type': 'application/json' } })
}
