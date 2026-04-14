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
import { filterOutRecommended, addRecommended } from './kv'

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
  count: number
): Promise<RecommendedTrack[]> {
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

  // Pool A: unseen tracks from known artists
  const poolAPromises = knownArtists.slice(0, 10).map(async (artist) => {
    try {
      const albumIds = await getArtistAlbums(userId, artist.id)
      const trackArrays = await Promise.all(
        albumIds.slice(0, 3).map((id) => getAlbumTracks(userId, id))
      )
      return trackArrays.flat().filter((t) => t.id && !recentIds.has(t.id))
    } catch {
      return []
    }
  })
  const poolARaw = (await Promise.all(poolAPromises)).flat()

  const poolAFiltered = await filterOutRecommended(
    userId,
    poolARaw.map((t) => t.id)
  )
  const poolAIdSet = new Set(poolAFiltered)
  const poolA = poolARaw.filter((t) => poolAIdSet.has(t.id))

  // Pool B: top tracks from related (new) artists
  const relatedResults = await Promise.all(
    knownArtists.slice(0, 5).map((a) => getRelatedArtists(userId, a.id).catch(() => [] as SpotifyArtist[]))
  )
  const allRelated = relatedResults.flat()
  const newArtists = allRelated.filter((a) => !knownArtistIds.has(a.id))
  const uniqueNewArtists = Array.from(
    new Map(newArtists.map((a) => [a.id, a])).values()
  ).slice(0, 15)

  const poolBRaw = (
    await Promise.all(
      uniqueNewArtists.map((artist) =>
        getArtistTopTracks(userId, artist.id).catch(() => [] as SpotifyTrack[])
      )
    )
  )
    .flat()
    .filter((t) => t.id && !recentIds.has(t.id))

  const poolBFiltered = await filterOutRecommended(
    userId,
    poolBRaw.map((t) => t.id)
  )
  const poolBIdSet = new Set(poolBFiltered)
  const poolB = poolBRaw.filter((t) => poolBIdSet.has(t.id))

  // Mix 50/50
  const half = Math.ceil(count / 2)
  const selectedA = shuffle(poolA).slice(0, half).map((t) => toRecommended(t, false))
  const selectedB = shuffle(poolB)
    .slice(0, count - selectedA.length)
    .map((t) => toRecommended(t, true))

  const combined = shuffle([...selectedA, ...selectedB])

  // Save to history so they don't repeat
  await addRecommended(userId, combined.map((t) => t.id))

  return combined
}
