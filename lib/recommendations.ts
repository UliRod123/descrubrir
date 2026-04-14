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

  // Fetch base data in parallel — fast
  const [shortArtists, longArtists, recentIds] = await Promise.all([
    getTopArtists(userId, 'short_term').catch(() => [] as SpotifyArtist[]),
    getTopArtists(userId, 'long_term').catch(() => [] as SpotifyArtist[]),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  // Deduplicate known artists
  const artistMap = new Map<string, SpotifyArtist>()
  for (const a of [...shortArtists, ...longArtists]) artistMap.set(a.id, a)
  const knownArtists = Array.from(artistMap.values())
  const knownArtistIds = new Set(artistMap.keys())

  if (knownArtists.length === 0) return []

  // Pool A: top tracks from known artists — all in parallel, no delays
  const poolATracksNested = await Promise.all(
    knownArtists.slice(0, 5).map((a) =>
      getArtistTopTracks(userId, a.id).catch(() => [] as SpotifyTrack[])
    )
  )
  const poolARaw = poolATracksNested.flat().filter((t) => t.id && !recentIds.has(t.id))

  // Pool B: get related artists then their top tracks — two parallel steps
  const relatedNested = await Promise.all(
    knownArtists.slice(0, 3).map((a) =>
      getRelatedArtists(userId, a.id).catch(() => [] as SpotifyArtist[])
    )
  )
  const newArtists = shuffle(
    Array.from(
      new Map(
        relatedNested.flat()
          .filter((a) => !knownArtistIds.has(a.id))
          .map((a) => [a.id, a])
      ).values()
    )
  ).slice(0, 5)

  const poolBTracksNested = await Promise.all(
    newArtists.map((a) =>
      getArtistTopTracks(userId, a.id).catch(() => [] as SpotifyTrack[])
    )
  )
  const poolBRaw = poolBTracksNested.flat().filter((t) => t.id && !recentIds.has(t.id))

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
