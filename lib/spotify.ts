import { getTokens, saveTokens, SpotifyTokens } from './kv'

const BASE = 'https://api.spotify.com/v1'

async function refreshAccessToken(userId: string, tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  const data = await res.json()
  const newTokens: SpotifyTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
  await saveTokens(userId, newTokens)
  return newTokens
}

export async function spotifyFetch<T>(
  userId: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let tokens = await getTokens(userId)
  if (!tokens) throw new Error('No tokens for user')

  if (Date.now() > tokens.expires_at - 60_000) {
    tokens = await refreshAccessToken(userId, tokens)
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify API error ${res.status}: ${text}`)
  }

  if (res.status === 204) return {} as T
  return res.json()
}

export interface SpotifyArtist {
  id: string
  name: string
}

export interface SpotifyTrack {
  id: string
  name: string
  uri: string
  artists: SpotifyArtist[]
  album: { images: { url: string }[] }
}

export async function getTopArtists(
  userId: string,
  timeRange: 'short_term' | 'medium_term' | 'long_term'
): Promise<SpotifyArtist[]> {
  const data = await spotifyFetch<{ items: SpotifyArtist[] }>(
    userId,
    `/me/top/artists?time_range=${timeRange}&limit=20`
  )
  return data.items
}

export interface SpotifyArtistFull extends SpotifyArtist {
  genres: string[]
}

export async function getTopTracks(
  userId: string,
  timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
  limit = 50
): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{ items: SpotifyTrack[] }>(
    userId,
    `/me/top/tracks?time_range=${timeRange}&limit=${limit}`
  )
  return data.items
}

export async function searchTracks(userId: string, query: string, limit = 20): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(limit), market: 'MX' })
  const data = await spotifyFetch<{ tracks: { items: SpotifyTrack[] } }>(
    userId,
    `/search?${params.toString()}`
  )
  return data.tracks.items
}

export async function getTopArtistsFull(
  userId: string,
  timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
  limit = 20
): Promise<SpotifyArtistFull[]> {
  const data = await spotifyFetch<{ items: SpotifyArtistFull[] }>(
    userId,
    `/me/top/artists?time_range=${timeRange}&limit=${limit}`
  )
  return data.items
}

// Spotify's own recommendations engine — most efficient (1 API call, great variety)
export async function getSpotifyRecommendations(
  userId: string,
  seedArtistIds: string[],
  seedGenres: string[],
  limit: number
): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({ limit: String(Math.min(limit, 100)) })
  if (seedArtistIds.length) params.set('seed_artists', seedArtistIds.slice(0, 3).join(','))
  if (seedGenres.length) params.set('seed_genres', seedGenres.slice(0, 2).join(','))
  const data = await spotifyFetch<{ tracks: SpotifyTrack[] }>(
    userId,
    `/recommendations?${params.toString()}`
  )
  return data.tracks
}

export async function getRecentlyPlayedTrackIds(userId: string): Promise<Set<string>> {
  const data = await spotifyFetch<{ items: { track: { id: string } }[] }>(
    userId,
    '/me/player/recently-played?limit=50'
  )
  return new Set(data.items.map((i) => i.track.id))
}

export async function getArtistAlbums(userId: string, artistId: string): Promise<string[]> {
  const data = await spotifyFetch<{ items: { id: string }[] }>(
    userId,
    `/artists/${artistId}/albums?include_groups=album,single&market=US&limit=10`
  )
  return data.items.map((a) => a.id)
}

export async function getAlbumTracks(userId: string, albumId: string): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{ items: SpotifyTrack[] }>(
    userId,
    `/albums/${albumId}/tracks?limit=50`
  )
  return data.items
}

export async function getRelatedArtists(userId: string, artistId: string): Promise<SpotifyArtist[]> {
  const data = await spotifyFetch<{ artists: SpotifyArtist[] }>(
    userId,
    `/artists/${artistId}/related-artists`
  )
  return data.artists.slice(0, 5)
}

export async function getArtistTopTracks(userId: string, artistId: string): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{ tracks: SpotifyTrack[] }>(
    userId,
    `/artists/${artistId}/top-tracks?market=MX`
  )
  return data.tracks
}

export async function addToQueue(userId: string, trackUri: string): Promise<void> {
  await spotifyFetch(userId, `/me/player/queue?uri=${encodeURIComponent(trackUri)}`, {
    method: 'POST',
  })
}

export async function getCurrentUserId(userId: string): Promise<string> {
  const data = await spotifyFetch<{ id: string }>(userId, '/me')
  return data.id
}

export async function createPlaylist(
  userId: string,
  spotifyUserId: string,
  name: string
): Promise<string> {
  const data = await spotifyFetch<{ id: string }>(
    userId,
    `/users/${spotifyUserId}/playlists`,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        public: true,
        description: 'Tu discovery diario — generado automáticamente',
      }),
    }
  )
  return data.id
}

export async function replacePlaylistTracks(
  userId: string,
  playlistId: string,
  uris: string[]
): Promise<void> {
  await spotifyFetch(userId, `/playlists/${playlistId}/tracks`, {
    method: 'PUT',
    body: JSON.stringify({ uris }),
  })
}

export async function addTracksToPlaylist(
  userId: string,
  playlistId: string,
  uris: string[]
): Promise<void> {
  await spotifyFetch(userId, `/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ uris }),
  })
}
