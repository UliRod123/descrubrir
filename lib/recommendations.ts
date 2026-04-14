import {
  getTopArtistsFull,
  getTopTracks,
  getRecentlyPlayedTrackIds,
  getSpotifyRecommendations,
  SpotifyTrack,
} from './spotify'
import { filterOutRecommended, addRecommended, getCachedRecommendations, setCachedRecommendations } from './kv'

export interface RecommendedTrack {
  id: string
  name: string
  uri: string
  artist: string
  artistIsNew: boolean
  albumArt: string
}

// English/international genres to mix in for variety
const VARIETY_GENRES = [
  'pop', 'hip-hop', 'r-n-b', 'indie-pop', 'electronic',
  'soul', 'funk', 'alternative', 'rock', 'dance',
]

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
  // Serve from cache if available (avoids hitting Spotify API on every page load)
  if (!skipCache) {
    const cached = await getCachedRecommendations(userId)
    if (cached && cached.length >= Math.min(count, 10)) return cached.slice(0, count)
  }

  // Fetch base data — only 3 API calls total
  const [topArtists, topTracks, recentIds] = await Promise.all([
    getTopArtistsFull(userId),
    getTopTracks(userId),
    getRecentlyPlayedTrackIds(userId),
  ])

  const knownArtistIds = new Set(topArtists.map((a) => a.id))

  // Extract user's genres from their top artists
  const userGenres = Array.from(
    new Set(topArtists.flatMap((a) => a.genres))
  ).slice(0, 3)

  // Pick 2 random variety genres different from user's usual genres
  const extraGenres = shuffle(
    VARIETY_GENRES.filter((g) => !userGenres.some((ug) => ug.includes(g)))
  ).slice(0, 2)

  const seedArtistIds = topArtists.slice(0, 3).map((a) => a.id)
  const seedTrackIds = topTracks.slice(0, 2).map((t) => t.id)

  // Pool A: recommendations based on user's own artists (~familiar feel, may include new artists)
  // Pool B: recommendations based on genre variety (more adventurous)
  const batchSize = Math.min(Math.ceil(count * 1.5), 100) // fetch extra to have room after filtering

  const [poolARaw, poolBRaw] = await Promise.all([
    getSpotifyRecommendations(userId, seedArtistIds, userGenres, batchSize).catch(() => [] as SpotifyTrack[]),
    getSpotifyRecommendations(userId, seedTrackIds.length ? [] : seedArtistIds.slice(0, 1), [...userGenres.slice(0, 1), ...extraGenres], batchSize).catch(() => [] as SpotifyTrack[]),
  ])

  // Filter out recently played
  const filterRecent = (tracks: SpotifyTrack[]) =>
    tracks.filter((t) => t.id && !recentIds.has(t.id))

  const poolAClean = filterRecent(poolARaw)
  const poolBClean = filterRecent(poolBRaw)

  // Filter out already recommended
  const [poolAIds, poolBIds] = await Promise.all([
    filterOutRecommended(userId, poolAClean.map((t) => t.id)),
    filterOutRecommended(userId, poolBClean.map((t) => t.id)),
  ])

  const poolASet = new Set(poolAIds)
  const poolBSet = new Set(poolBIds)

  const poolA = poolAClean.filter((t) => poolASet.has(t.id))
  const poolB = poolBClean.filter((t) => poolBSet.has(t.id))

  // Mark as "new artist" if not in user's known top artists
  const shuffledA = shuffle(poolA)
  const shuffledB = shuffle(poolB)

  const half = Math.ceil(count / 2)
  const fromA = shuffledA.slice(0, half).map((t) => toRecommended(t, !knownArtistIds.has(t.artists[0]?.id)))
  const fromB = shuffledB.slice(0, count - fromA.length).map((t) => toRecommended(t, !knownArtistIds.has(t.artists[0]?.id)))

  // Fill any remaining gap from whichever pool has more
  const gap = count - fromA.length - fromB.length
  const extra = gap > 0
    ? shuffledA.slice(half, half + gap).map((t) => toRecommended(t, !knownArtistIds.has(t.artists[0]?.id)))
    : []

  const combined = shuffle([...fromA, ...fromB, ...extra])

  if (combined.length > 0) {
    await addRecommended(userId, combined.map((t) => t.id))
    await setCachedRecommendations(userId, combined)
  }

  return combined
}
