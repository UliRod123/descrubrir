import {
  getTopArtistsFull,
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
  // Serve from cache on page load to avoid hitting Spotify API every time
  if (!skipCache) {
    const cached = await getCachedRecommendations(userId)
    if (cached && cached.length >= Math.min(count, 10)) return cached.slice(0, count)
  }

  const [topArtists, recentIds] = await Promise.all([
    getTopArtistsFull(userId),
    getRecentlyPlayedTrackIds(userId),
  ])

  const knownArtistIds = new Set(topArtists.map((a) => a.id))

  // Pool A: top tracks from user's known artists (sequential, 3 at a time)
  const poolAResults: SpotifyTrack[] = []
  const artistsForA = topArtists.slice(0, 8)
  for (let i = 0; i < artistsForA.length; i += 3) {
    const batch = artistsForA.slice(i, i + 3)
    const results = await Promise.all(
      batch.map((a) => getArtistTopTracks(userId, a.id).catch(() => [] as SpotifyTrack[]))
    )
    poolAResults.push(...results.flat())
  }

  // Pool B: top tracks from related artists (new discovery)
  const relatedArtistMap = new Map<string, SpotifyArtist>()
  const seedArtists = topArtists.slice(0, 4)
  for (let i = 0; i < seedArtists.length; i += 2) {
    const batch = seedArtists.slice(i, i + 2)
    const results = await Promise.all(
      batch.map((a) => getRelatedArtists(userId, a.id).catch(() => [] as SpotifyArtist[]))
    )
    for (const related of results.flat()) {
      if (!knownArtistIds.has(related.id)) relatedArtistMap.set(related.id, related)
    }
  }

  const newArtists = shuffle(Array.from(relatedArtistMap.values())).slice(0, 8)
  const poolBResults: SpotifyTrack[] = []
  for (let i = 0; i < newArtists.length; i += 3) {
    const batch = newArtists.slice(i, i + 3)
    const results = await Promise.all(
      batch.map((a) => getArtistTopTracks(userId, a.id).catch(() => [] as SpotifyTrack[]))
    )
    poolBResults.push(...results.flat())
  }

  // Filter: remove recently played tracks
  const poolAClean = poolAResults.filter((t) => t.id && !recentIds.has(t.id))
  const poolBClean = poolBResults.filter((t) => t.id && !recentIds.has(t.id))

  // Filter: remove already recommended tracks
  const [poolANew, poolBNew] = await Promise.all([
    filterOutRecommended(userId, poolAClean.map((t) => t.id)).then(
      (ids) => { const s = new Set(ids); return poolAClean.filter((t) => s.has(t.id)) }
    ),
    filterOutRecommended(userId, poolBClean.map((t) => t.id)).then(
      (ids) => { const s = new Set(ids); return poolBClean.filter((t) => s.has(t.id)) }
    ),
  ])

  // If both pools are empty, the history is exhausted — reset and use unfiltered tracks
  let finalPoolA = poolANew
  let finalPoolB = poolBNew

  if (finalPoolA.length === 0 && finalPoolB.length === 0) {
    await clearRecommendedHistory(userId)
    finalPoolA = shuffle(poolAClean)
    finalPoolB = shuffle(poolBClean)
  }

  // Mix 50/50 with gap filling
  const shuffledA = shuffle(finalPoolA)
  const shuffledB = shuffle(finalPoolB)
  const half = Math.ceil(count / 2)

  const fromA = shuffledA.slice(0, half).map((t) => toRecommended(t, false))
  const fromB = shuffledB.slice(0, count - fromA.length).map((t) => toRecommended(t, true))
  const gap = count - fromA.length - fromB.length
  const extra = gap > 0 ? shuffledA.slice(half, half + gap).map((t) => toRecommended(t, false)) : []

  const combined = shuffle([...fromA, ...fromB, ...extra])

  if (combined.length > 0) {
    await addRecommended(userId, combined.map((t) => t.id))
    await setCachedRecommendations(userId, combined)
  }

  return combined
}
