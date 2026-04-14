import {
  getTopArtists,
  getRecentlyPlayedTrackIds,
  getRelatedArtists,
  getArtistTopTracks,
  SpotifyTrack,
  SpotifyArtist,
} from './spotify'
import {
  filterOutRecommended,
  addRecommended,
  getCachedRecommendations,
  setCachedRecommendations,
  clearRecommendedHistory,
} from './kv'

export interface RecommendedTrack {
  id: string
  name: string
  uri: string
  artist: string
  artistIsNew: boolean
  albumArt: string
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function toRecommended(track: SpotifyTrack, artistIsNew: boolean): RecommendedTrack {
  return {
    id: track.id,
    name: track.name,
    uri: track.uri,
    artist: track.artists[0]?.name ?? 'Unknown',
    artistIsNew,
    albumArt: track.album?.images?.[0]?.url ?? '',
  }
}

export async function getRecommendations(
  userId: string,
  count: number,
  skipCache = false
): Promise<RecommendedTrack[]> {
  if (!skipCache) {
    const cached = await getCachedRecommendations(userId)
    if (cached && cached.length >= Math.min(count, 10)) return cached.slice(0, count)
  }

  // Fetch base data in parallel — all 3 time ranges for best coverage
  const [shortArtists, mediumArtists, longArtists, recentIds] = await Promise.all([
    getTopArtists(userId, 'short_term').catch(() => [] as SpotifyArtist[]),
    getTopArtists(userId, 'medium_term').catch(() => [] as SpotifyArtist[]),
    getTopArtists(userId, 'long_term').catch(() => [] as SpotifyArtist[]),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  // Deduplicate known artists across all time ranges
  const artistMap = new Map<string, SpotifyArtist>()
  for (const a of [...shortArtists, ...mediumArtists, ...longArtists]) artistMap.set(a.id, a)
  const knownArtists = Array.from(artistMap.values())
  const knownArtistIds = new Set(artistMap.keys())

  if (knownArtists.length === 0) return []

  // Pool A: top tracks from known artists (top 8 for more variety)
  const poolAResults = await Promise.allSettled(
    knownArtists.slice(0, 8).map((a) => getArtistTopTracks(userId, a.id))
  )
  const poolARaw = poolAResults
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((t) => t.id && t.uri && !recentIds.has(t.id))

  // Pool B: get related artists then their top tracks
  const relatedResults = await Promise.allSettled(
    knownArtists.slice(0, 5).map((a) => getRelatedArtists(userId, a.id))
  )
  const newArtists = shuffle(
    Array.from(
      new Map(
        relatedResults
          .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
          .filter((a) => !knownArtistIds.has(a.id))
          .map((a) => [a.id, a])
      ).values()
    )
  ).slice(0, 8)

  const poolBResults = await Promise.allSettled(
    newArtists.map((a) => getArtistTopTracks(userId, a.id))
  )
  const poolBRaw = poolBResults
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((t) => t.id && t.uri && !recentIds.has(t.id))

  // Filter already recommended
  const [poolAFiltered, poolBFiltered] = await Promise.all([
    filterOutRecommended(userId, poolARaw.map((t) => t.id)),
    filterOutRecommended(userId, poolBRaw.map((t) => t.id)),
  ])

  const poolASet = new Set(poolAFiltered)
  const poolBSet = new Set(poolBFiltered)
  let poolA = poolARaw.filter((t) => poolASet.has(t.id))
  let poolB = poolBRaw.filter((t) => poolBSet.has(t.id))

  // Auto-reset history if both pools exhausted
  if (poolA.length === 0 && poolB.length === 0) {
    await clearRecommendedHistory(userId)
    poolA = shuffle(poolARaw)
    poolB = shuffle(poolBRaw)
  }

  // If still empty after reset, pools themselves are empty — return error info
  if (poolA.length === 0 && poolB.length === 0) {
    return []
  }

  // Mix 50/50 with gap filling
  const half = Math.ceil(count / 2)
  const fromA = shuffle(poolA).slice(0, half).map((t) => toRecommended(t, false))
  const fromB = shuffle(poolB).slice(0, count - fromA.length).map((t) => toRecommended(t, true))
  const gap = count - fromA.length - fromB.length
  const extra = gap > 0
    ? shuffle(poolA).slice(half, half + gap).map((t) => toRecommended(t, false))
    : []

  const combined = shuffle([...fromA, ...fromB, ...extra])

  if (combined.length > 0) {
    await addRecommended(userId, combined.map((t) => t.id))
    await setCachedRecommendations(userId, combined)
  }

  return combined
}

export async function getRecommendationsDiagnostics(userId: string): Promise<Record<string, unknown>> {
  const [shortArtists, mediumArtists, longArtists, recentIds] = await Promise.all([
    getTopArtists(userId, 'short_term').catch((e) => ({ error: String(e) })),
    getTopArtists(userId, 'medium_term').catch((e) => ({ error: String(e) })),
    getTopArtists(userId, 'long_term').catch((e) => ({ error: String(e) })),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  const artistList = [
    ...((shortArtists as SpotifyArtist[]) ?? []),
    ...((mediumArtists as SpotifyArtist[]) ?? []),
    ...((longArtists as SpotifyArtist[]) ?? []),
  ]
  const firstArtist = artistList[0]

  let topTracksResult: unknown = null
  if (firstArtist) {
    topTracksResult = await getArtistTopTracks(userId, firstArtist.id)
      .then((t) => ({ ok: true, count: t.length, sample: t.slice(0, 3).map((x) => x.name) }))
      .catch((e) => ({ ok: false, error: String(e) }))
  }

  return {
    shortArtistsCount: Array.isArray(shortArtists) ? shortArtists.length : shortArtists,
    mediumArtistsCount: Array.isArray(mediumArtists) ? mediumArtists.length : mediumArtists,
    longArtistsCount: Array.isArray(longArtists) ? longArtists.length : longArtists,
    recentIdsCount: recentIds instanceof Set ? recentIds.size : 0,
    firstArtist: firstArtist?.name,
    topTracksResult,
  }
}
