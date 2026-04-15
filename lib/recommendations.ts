import {
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

export type DiscoveryMode = 'mis-artistas' | 'ingles' | 'generos'

const MODE_KEYWORDS: Record<Exclude<DiscoveryMode, 'mis-artistas'>, string[]> = {
  ingles: ['pop 2024', 'r&b 2024', 'hip hop 2025', 'indie pop 2024', 'alternative 2024'],
  generos: ['electronic 2024', 'jazz 2024', 'reggaeton 2025', 'latin pop 2024', 'funk 2024'],
}

export async function getRecommendations(
  userId: string,
  count: number,
  skipCache?: boolean,
  modes?: DiscoveryMode[]
): Promise<RecommendedTrack[]> {
  const activeModes: DiscoveryMode[] = modes && modes.length > 0 ? modes : ['mis-artistas']

  if (!skipCache) {
    const cached = await getCachedRecommendations(userId)
    if (cached && cached.length >= Math.min(count, 10)) return cached.slice(0, count)
  }

  // Fetch user data
  const [artists, recentIds] = await Promise.all([
    getTopArtistsFull(userId, 'medium_term', 20).catch(() => []),
    getRecentlyPlayedTrackIds(userId).catch(() => new Set<string>()),
  ])

  const knownArtistIds = new Set(artists.map(a => a.id))

  // Discovery pool: search results filtered only by recently played
  // (Redis anti-repeat history handles not repeating recommendations)
  const topArtists = artists.slice(0, 10)

  const artistQueries = topArtists.map(a => searchTracks(userId, `artist:"${a.name}"`, 30))
  const keywordQueries: Promise<SpotifyTrack[]>[] = []
  for (const mode of activeModes) {
    if (mode === 'mis-artistas') continue
    for (const kw of MODE_KEYWORDS[mode as Exclude<DiscoveryMode, 'mis-artistas'>]) {
      keywordQueries.push(searchTracks(userId, kw, 50))
    }
  }

  const searchResults = await Promise.allSettled([...artistQueries, ...keywordQueries])

  const poolMap = new Map<string, SpotifyTrack>()
  for (const result of searchResults) {
    if (result.status === 'fulfilled') {
      for (const t of result.value) {
        if (t.id && t.uri && !recentIds.has(t.id)) {
          poolMap.set(t.id, t)
        }
      }
    }
  }
  let poolRaw = Array.from(poolMap.values())

  // Filter already recommended (anti-repeat history)
  const filtered = await filterOutRecommended(userId, poolRaw.map(t => t.id))
  const filteredSet = new Set(filtered)
  let pool = poolRaw.filter(t => filteredSet.has(t.id))

  // Auto-reset history if pool exhausted
  if (pool.length === 0) {
    await clearRecommendedHistory(userId)
    pool = shuffle(poolRaw)
  }

  if (pool.length === 0) return []

  // Deduplicate by name+artist (same song can appear as single and album version)
  const seen = new Set<string>()
  const deduped = shuffle(pool).filter(t => {
    const key = `${t.name.toLowerCase()}:::${t.artists[0]?.name.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const combined = deduped.slice(0, count).map(t => toRecommended(t, knownArtistIds))

  if (combined.length > 0) {
    await addRecommended(userId, combined.map(t => t.id))
    await setCachedRecommendations(userId, combined)
  }

  return combined
}

export async function getRecommendationsDiagnostics(userId: string): Promise<Record<string, unknown>> {
  const [artists, recentIds] = await Promise.all([
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
    recentIdsCount: recentIds instanceof Set ? recentIds.size : 0,
    artistCount: Array.isArray(artists) ? artists.length : artists,
    searchTest,
  }
}
