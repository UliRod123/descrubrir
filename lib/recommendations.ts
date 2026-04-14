import {
  getTopTracks,
  getTopArtistsFull,
  searchTracks,
  getRecentlyPlayedTrackIds,
  SpotifyTrack,
  SpotifyArtistFull,
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

  // Fetch user data in parallel — all /me/ endpoints, always work
  const [tracksShort, tracksMedium, tracksLong, artistsFull, recentIds] = await Promise.all([
    getTopTracks(userId, 'short_term', 50).catch(() => [] as SpotifyTrack[]),
    getTopTracks(userId, 'medium_term', 50).catch(() => [] as SpotifyTrack[]),
    getTopTracks(userId, 'long_term', 50).catch(() => [] as SpotifyTrack[]),
    getTopArtistsFull(userId, 'medium_term', 20).catch(() => [] as SpotifyArtistFull[]),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  // Pool A: user's own top tracks across all time ranges, minus recently played
  const trackMap = new Map<string, SpotifyTrack>()
  for (const t of [...tracksShort, ...tracksMedium, ...tracksLong]) {
    if (t.id && t.uri) trackMap.set(t.id, t)
  }
  const knownArtistIds = new Set(artistsFull.map(a => a.id))
  const poolARaw = Array.from(trackMap.values()).filter(t => !recentIds.has(t.id))

  // Pool B: search tracks by user's top genres — discovers new artists/tracks
  const genres = Array.from(
    new Set(artistsFull.flatMap(a => a.genres ?? []))
  ).slice(0, 6)

  // Also search by top artist names for variety
  const topArtistNames = artistsFull.slice(0, 4).map(a => a.name)

  const searchQueries = [
    ...genres.slice(0, 3).map(g => `genre:"${g}"`),
    ...topArtistNames.slice(0, 2).map(name => `artist:"${name}"`),
  ]

  const searchResults = await Promise.allSettled(
    searchQueries.map(q => searchTracks(userId, q, 20))
  )

  const poolBRaw = Array.from(
    new Map(
      searchResults
        .flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .filter(t => t.id && t.uri && !recentIds.has(t.id))
        .map(t => [t.id, t])
    ).values()
  )
  // Pool B "new artist" = track whose primary artist is NOT in user's known artists
  const poolBNew = poolBRaw.filter(t => !knownArtistIds.has(t.artists[0]?.id ?? ''))
  const poolBKnown = poolBRaw.filter(t => knownArtistIds.has(t.artists[0]?.id ?? ''))
  // Prefer new artists for Pool B, fall back to known if needed
  const poolBCombined = [...poolBNew, ...poolBKnown]

  // Filter already recommended
  const [poolAFiltered, poolBFiltered] = await Promise.all([
    filterOutRecommended(userId, poolARaw.map(t => t.id)),
    filterOutRecommended(userId, poolBCombined.map(t => t.id)),
  ])

  const poolASet = new Set(poolAFiltered)
  const poolBSet = new Set(poolBFiltered)
  let poolA = poolARaw.filter(t => poolASet.has(t.id))
  let poolB = poolBCombined.filter(t => poolBSet.has(t.id))

  // Auto-reset history if both pools exhausted
  if (poolA.length === 0 && poolB.length === 0) {
    await clearRecommendedHistory(userId)
    poolA = shuffle(poolARaw)
    poolB = shuffle(poolBCombined)
  }

  if (poolA.length === 0 && poolB.length === 0) return []

  // Mix: 50% Pool A (familiar) + 50% Pool B (discovery)
  const half = Math.ceil(count / 2)
  const fromA = shuffle(poolA).slice(0, half).map(t => toRecommended(t, false))
  const fromB = shuffle(poolB).slice(0, count - fromA.length).map(t => {
    const isNew = !knownArtistIds.has(t.artists[0]?.id ?? '')
    return toRecommended(t, isNew)
  })
  const gap = count - fromA.length - fromB.length
  const extra = gap > 0
    ? shuffle(poolA).slice(half, half + gap).map(t => toRecommended(t, false))
    : []

  const combined = shuffle([...fromA, ...fromB, ...extra])

  if (combined.length > 0) {
    await addRecommended(userId, combined.map(t => t.id))
    await setCachedRecommendations(userId, combined)
  }

  return combined
}

export async function getRecommendationsDiagnostics(userId: string): Promise<Record<string, unknown>> {
  const [tracksShort, tracksMedium, tracksLong, artistsFull, recentIds] = await Promise.all([
    getTopTracks(userId, 'short_term', 50).catch((e) => ({ error: String(e) })),
    getTopTracks(userId, 'medium_term', 50).catch((e) => ({ error: String(e) })),
    getTopTracks(userId, 'long_term', 50).catch((e) => ({ error: String(e) })),
    getTopArtistsFull(userId, 'medium_term', 20).catch((e) => ({ error: String(e) })),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  const genres = Array.isArray(artistsFull)
    ? Array.from(new Set(artistsFull.flatMap(a => a.genres ?? []))).slice(0, 4)
    : []

  let searchTest: unknown = null
  if (genres.length > 0) {
    searchTest = await searchTracks(userId, `genre:"${genres[0]}"`, 5)
      .then(t => ({ ok: true, count: t.length, sample: t.slice(0, 3).map(x => `${x.name} - ${x.artists[0]?.name}`) }))
      .catch(e => ({ ok: false, error: String(e) }))
  }

  return {
    tracksShort: Array.isArray(tracksShort) ? tracksShort.length : tracksShort,
    tracksMedium: Array.isArray(tracksMedium) ? tracksMedium.length : tracksMedium,
    tracksLong: Array.isArray(tracksLong) ? tracksLong.length : tracksLong,
    recentIdsCount: recentIds instanceof Set ? recentIds.size : 0,
    genres,
    searchTest,
  }
}
