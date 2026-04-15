import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getTopArtistsFull, searchTracks, getRecentlyPlayedTrackIds } from '@/lib/spotify'
import { redis } from '@/lib/kv'

export const maxDuration = 30

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.userId

  // ── Step 1: Artists ──────────────────────────────────────────────────────────
  const artistsResult = await getTopArtistsFull(userId, 'medium_term', 20).catch(e => ({ error: String(e) }))
  const artistsOk = Array.isArray(artistsResult)
  const artistList = artistsOk ? artistsResult : []
  const topArtists = artistList.slice(0, 10)

  // ── Step 2: Recently played ──────────────────────────────────────────────────
  const recentIds = await getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>())
  const recentCount = recentIds instanceof Set ? recentIds.size : 0

  // ── Step 3: Sample search (first 3 artists) ──────────────────────────────────
  const sampleSearches: Record<string, unknown> = {}
  for (const a of topArtists.slice(0, 3)) {
    const query = `artist:"${a.name}"`
    sampleSearches[a.name] = await searchTracks(userId, query, 10)
      .then(tracks => ({ ok: true, count: tracks.length, sample: tracks.slice(0, 2).map(t => `${t.name} — ${t.artists[0]?.name}`) }))
      .catch(e => ({ ok: false, error: String(e) }))
  }

  // ── Step 4: Full pool (all 10 artists) ───────────────────────────────────────
  const artistQueries = topArtists.map(a => searchTracks(userId, `artist:"${a.name}"`, 30))
  const searchResults = await Promise.allSettled(artistQueries)

  let searchFulfilled = 0
  let searchRejected = 0
  const searchErrors: string[] = []
  const poolMap = new Map<string, { id: string; name: string; artist: string }>()
  let totalTracksFromSearch = 0
  let blockedByRecentlyPlayed = 0

  for (const result of searchResults) {
    if (result.status === 'rejected') {
      searchRejected++
      searchErrors.push(String(result.reason))
    } else {
      searchFulfilled++
      for (const t of result.value) {
        totalTracksFromSearch++
        if (t.id && t.uri) {
          if (recentIds.has(t.id)) {
            blockedByRecentlyPlayed++
          } else {
            poolMap.set(t.id, { id: t.id, name: t.name, artist: t.artists[0]?.name ?? '?' })
          }
        }
      }
    }
  }

  const poolRaw = Array.from(poolMap.values())

  // ── Step 5: Redis recommended set ────────────────────────────────────────────
  const recommendedSetSize = await redis.scard(`user:${userId}:recommended`).catch(() => -1)

  // ── Step 6: Pipeline sismember — expose raw values ───────────────────────────
  let pipelineBlocked = 0
  let pipelinePassed = 0
  const rawPipelineSample: Array<{ track: string; rawValue: unknown; typeofValue: string; passedCheck: boolean }> = []

  if (poolRaw.length > 0) {
    const sampleIds = poolRaw.slice(0, 5)
    const fullIds = poolRaw

    const pipeline = redis.pipeline()
    for (const t of fullIds) {
      pipeline.sismember(`user:${userId}:recommended`, t.id)
    }
    const results = await pipeline.exec()

    // Expose raw values for first 5
    for (let i = 0; i < Math.min(5, sampleIds.length); i++) {
      const val = results[i]
      rawPipelineSample.push({
        track: `${sampleIds[i].name} — ${sampleIds[i].artist}`,
        rawValue: val,
        typeofValue: typeof val,
        passedCheck: val === 0,
      })
    }

    // Count all
    for (let i = 0; i < fullIds.length; i++) {
      if (results[i] === 0) {
        pipelinePassed++
      } else {
        pipelineBlocked++
      }
    }
  }

  // ── Step 7: Verdict ──────────────────────────────────────────────────────────
  let verdict: string
  if (topArtists.length === 0) {
    verdict = '❌ NO_ARTISTS: getTopArtistsFull returned 0 artists — Spotify top artists unavailable'
  } else if (totalTracksFromSearch === 0) {
    verdict = `❌ SEARCH_EMPTY: ${searchFulfilled}/${topArtists.length} searches succeeded but returned 0 tracks`
  } else if (poolRaw.length === 0) {
    verdict = `❌ ALL_RECENT: All ${totalTracksFromSearch} tracks were in recently-played (${recentCount} recent IDs)`
  } else if (pipelinePassed === 0 && recommendedSetSize > 0) {
    verdict = `❌ REDIS_FULL: Redis set has ${recommendedSetSize} entries — all ${poolRaw.length} pool tracks are in the recommended history. Run /api/reset-history`
  } else if (pipelinePassed === 0 && recommendedSetSize === 0) {
    verdict = `❌ REDIS_BUG: Redis set is empty but pipeline returned 0 passing tracks — results[i] === 0 check failing. Likely type mismatch.`
  } else {
    verdict = `✅ SHOULD_WORK: ${pipelinePassed} tracks available after filtering (${pipelineBlocked} blocked by history). Run /api/discover to test.`
  }

  return NextResponse.json({
    userId,
    step1_artists: {
      count: artistList.length,
      topArtists: topArtists.map(a => a.name),
      error: artistsOk ? undefined : (artistsResult as { error: string }).error,
    },
    step2_recent: { recentCount },
    step3_sampleSearches: sampleSearches,
    step4_pool: {
      searchFulfilled,
      searchRejected,
      searchErrors: searchErrors.slice(0, 3),
      totalTracksFromSearch,
      blockedByRecentlyPlayed,
      poolRawSize: poolRaw.length,
      samplePool: poolRaw.slice(0, 5).map(t => `${t.name} — ${t.artist}`),
    },
    step5_redis: {
      recommendedSetSize,
    },
    step6_pipeline: {
      pipelinePassed,
      pipelineBlocked,
      rawPipelineSample,
      note: 'rawValue should be 0 (number) for tracks NOT in the recommended set',
    },
    verdict,
  })
}
