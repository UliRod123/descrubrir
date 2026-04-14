import {
  getTopArtists,
  getRecentlyPlayedTrackIds,
  getArtistAlbums,
  getAlbumTracks,
  getRelatedArtists,
  getArtistTopTracks,
  SpotifyTrack,
  SpotifyArtist,
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

// Process items in small sequential batches to avoid Spotify rate limits
async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

export async function getRecommendations(
  userId: string,
  count: number,
  skipCache = false
): Promise<RecommendedTrack[]> {
  // Return cached recommendations if available (avoids rate limits on page reload)
  if (!skipCache) {
    const cached = await getCachedRecommendations(userId)
    if (cached && cached.length >= count) return cached.slice(0, count)
  }

  const [shortTerm, longTerm, recentIds] = await Promise.all([
    getTopArtists(userId, 'short_term'),
    getTopArtists(userId, 'long_term'),
    getRecentlyPlayedTrackIds(userId),
  ])

  // Merge and deduplicate known artists
  const knownArtistMap = new Map<string, SpotifyArtist>()
  for (const a of [...shortTerm, ...longTerm]) knownArtistMap.set(a.id, a)
  const knownArtists = Array.from(knownArtistMap.values())
  const knownArtistIds = new Set(knownArtistMap.keys())

  // Pool A: unseen tracks from known artists — process in batches of 3
  const poolANested = await batchProcess(
    knownArtists.slice(0, 12),
    3,
    async (artist) => {
      try {
        const albumIds = await getArtistAlbums(userId, artist.id)
        const tracks = await batchProcess(
          albumIds.slice(0, 3),
          3,
          (id) => getAlbumTracks(userId, id)
        )
        return tracks.flat().filter((t) => t.id && !recentIds.has(t.id))
      } catch {
        return []
      }
    }
  )
  const poolARaw = poolANested.flat()

  const poolAFiltered = await filterOutRecommended(userId, poolARaw.map((t) => t.id))
  const poolAIdSet = new Set(poolAFiltered)
  const poolA = poolARaw.filter((t) => poolAIdSet.has(t.id))

  // Pool B: top tracks from related artists — process in batches of 3
  const relatedNested = await batchProcess(
    knownArtists.slice(0, 5),
    3,
    (a) => getRelatedArtists(userId, a.id).catch(() => [] as SpotifyArtist[])
  )
  const allRelated = relatedNested.flat()
  const uniqueNewArtists = Array.from(
    new Map(
      allRelated.filter((a) => !knownArtistIds.has(a.id)).map((a) => [a.id, a])
    ).values()
  ).slice(0, 12)

  const poolBNested = await batchProcess(
    uniqueNewArtists,
    3,
    (artist) => getArtistTopTracks(userId, artist.id).catch(() => [] as SpotifyTrack[])
  )
  const poolBRaw = poolBNested.flat().filter((t) => t.id && !recentIds.has(t.id))

  const poolBFiltered = await filterOutRecommended(userId, poolBRaw.map((t) => t.id))
  const poolBIdSet = new Set(poolBFiltered)
  const poolB = poolBRaw.filter((t) => poolBIdSet.has(t.id))

  // Mix: 50/50 with fallback if one pool runs short
  const shuffledA = shuffle(poolA)
  const shuffledB = shuffle(poolB)
  const half = Math.ceil(count / 2)

  const fromA = shuffledA.slice(0, half)
  const fromB = shuffledB.slice(0, count - fromA.length)
  const remaining = count - fromA.length - fromB.length
  const extra = remaining > 0 ? shuffledA.slice(half, half + remaining) : []

  const selectedA = [...fromA, ...extra].map((t) => toRecommended(t, false))
  const selectedB = fromB.map((t) => toRecommended(t, true))
  const combined = shuffle([...selectedA, ...selectedB])

  // Save to history and cache
  await addRecommended(userId, combined.map((t) => t.id))
  await setCachedRecommendations(userId, combined)

  return combined
}
