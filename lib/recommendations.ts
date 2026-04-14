import {
  getTopTracks,
  getTopArtistsFull,
  searchTracks,
  getRecentlyPlayedTrackIds,
  SpotifyTrack,
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

function toRecommended(track: SpotifyTrack, knownArtistIds: Set<string>): RecommendedTrack {
  const artistIsNew = !knownArtistIds.has(track.artists[0]?.id ?? '')
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

  // Fetch all user data in parallel — only /me/ endpoints
  const [tracksShort, tracksMedium, tracksLong, artists, recentIds] = await Promise.all([
    getTopTracks(userId, 'short_term', 50).catch(() => [] as SpotifyTrack[]),
    getTopTracks(userId, 'medium_term', 50).catch(() => [] as SpotifyTrack[]),
    getTopTracks(userId, 'long_term', 50).catch(() => [] as SpotifyTrack[]),
    getTopArtistsFull(userId, 'medium_term', 20).catch(() => []),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  const knownArtistIds = new Set(artists.map(a => a.id))

  // Pool A: user's own top tracks (deduplicated across time ranges, minus recently played)
  const trackMap = new Map<string, SpotifyTrack>()
  for (const t of [...tracksShort, ...tracksMedium, ...tracksLong]) {
    if (t.id && t.uri) trackMap.set(t.id, t)
  }
  const poolARaw = Array.from(trackMap.values()).filter(t => !recentIds.has(t.id))

  // Pool B: search by top artist names — finds more tracks + collaborations with new artists
  // Searching artist:"X" returns tracks where X appears, including features/collabs
  const topArtists = artists.slice(0, 8)
  const searchResults = await Promise.allSettled(
    topArtists.map(a => searchTracks(userId, `artist:"${a.name}"`, 20))
  )

  const poolBMap = new Map<string, SpotifyTrack>()
  for (const result of searchResults) {
    if (result.status === 'fulfilled') {
      for (const t of result.value) {
        if (t.id && t.uri && !recentIds.has(t.id)) {
          poolBMap.set(t.id, t)
        }
      }
    }
  }
  // Remove tracks already in Pool A (no duplicates)
  for (const id of trackMap.keys()) poolBMap.delete(id)
  const poolBRaw = Array.from(poolBMap.values())

  // Filter already recommended from history
  const [poolAFiltered, poolBFiltered] = await Promise.all([
    filterOutRecommended(userId, poolARaw.map(t => t.id)),
    filterOutRecommended(userId, poolBRaw.map(t => t.id)),
  ])

  const poolASet = new Set(poolAFiltered)
  const poolBSet = new Set(poolBFiltered)
  let poolA = poolARaw.filter(t => poolASet.has(t.id))
  let poolB = poolBRaw.filter(t => poolBSet.has(t.id))

  // Auto-reset history if both pools exhausted
  if (poolA.length === 0 && poolB.length === 0) {
    await clearRecommendedHistory(userId)
    poolA = shuffle(poolARaw)
    poolB = shuffle(poolBRaw)
  }

  if (poolA.length === 0 && poolB.length === 0) return []

  // Mix: ~50% Pool A (your favorites) + ~50% Pool B (discovery via search)
  const half = Math.ceil(count / 2)
  const fromA = shuffle(poolA).slice(0, half).map(t => toRecommended(t, knownArtistIds))
  const fromB = shuffle(poolB).slice(0, count - fromA.length).map(t => toRecommended(t, knownArtistIds))
  const gap = count - fromA.length - fromB.length
  const extra = gap > 0
    ? shuffle(poolA).slice(half, half + gap).map(t => toRecommended(t, knownArtistIds))
    : []

  const combined = shuffle([...fromA, ...fromB, ...extra])

  if (combined.length > 0) {
    await addRecommended(userId, combined.map(t => t.id))
    await setCachedRecommendations(userId, combined)
  }

  return combined
}

export async function getRecommendationsDiagnostics(userId: string): Promise<Record<string, unknown>> {
  const [tracksShort, tracksMedium, tracksLong, artists, recentIds] = await Promise.all([
    getTopTracks(userId, 'short_term', 50).catch(e => ({ error: String(e) })),
    getTopTracks(userId, 'medium_term', 50).catch(e => ({ error: String(e) })),
    getTopTracks(userId, 'long_term', 50).catch(e => ({ error: String(e) })),
    getTopArtistsFull(userId, 'medium_term', 20).catch(e => ({ error: String(e) })),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  const firstArtist = Array.isArray(artists) ? artists[0] : null
  let searchTest: unknown = null
  if (firstArtist) {
    searchTest = await searchTracks(userId, `artist:"${firstArtist.name}"`, 5)
      .then(t => ({ ok: true, count: t.length, sample: t.map(x => `${x.name} - ${x.artists[0]?.name}`) }))
      .catch(e => ({ ok: false, error: String(e) }))
  }

  return {
    tracksShortCount: Array.isArray(tracksShort) ? tracksShort.length : tracksShort,
    tracksMediumCount: Array.isArray(tracksMedium) ? tracksMedium.length : tracksMedium,
    tracksLongCount: Array.isArray(tracksLong) ? tracksLong.length : tracksLong,
    recentIdsCount: recentIds instanceof Set ? recentIds.size : 0,
    artistCount: Array.isArray(artists) ? artists.length : artists,
    searchTest,
  }
}
