import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export interface SpotifyTokens {
  access_token: string
  refresh_token: string
  expires_at: number // unix ms
}

export async function saveTokens(userId: string, tokens: SpotifyTokens): Promise<void> {
  await redis.set(`user:${userId}:tokens`, JSON.stringify(tokens))
}

export async function getTokens(userId: string): Promise<SpotifyTokens | null> {
  const raw = await redis.get<string>(`user:${userId}:tokens`)
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as SpotifyTokens)
}

export async function savePlaylistId(userId: string, playlistId: string): Promise<void> {
  await redis.set(`user:${userId}:playlistId`, playlistId)
}

export async function getPlaylistId(userId: string): Promise<string | null> {
  return redis.get<string>(`user:${userId}:playlistId`)
}

export async function addRecommended(userId: string, trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return
  await redis.sadd(`user:${userId}:recommended`, trackIds[0], ...trackIds.slice(1))
  await redis.expire(`user:${userId}:recommended`, 60 * 60 * 24 * 30)
}

export async function filterOutRecommended(userId: string, trackIds: string[]): Promise<string[]> {
  if (trackIds.length === 0) return []
  const pipeline = redis.pipeline()
  for (const id of trackIds) {
    pipeline.sismember(`user:${userId}:recommended`, id)
  }
  const results = await pipeline.exec<number[]>()
  return trackIds.filter((_, i) => results[i] === 0)
}

export async function getAllUserIds(): Promise<string[]> {
  const keys = await redis.keys('user:*:tokens')
  return keys.map((k: string) => k.split(':')[1]).filter(Boolean)
}

// Cache recommendations for 2 hours to avoid Spotify rate limits
import type { RecommendedTrack } from './recommendations'

export async function getCachedRecommendations(userId: string): Promise<RecommendedTrack[] | null> {
  const raw = await redis.get<string>(`user:${userId}:recs_cache`)
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : (raw as RecommendedTrack[])
}

export async function setCachedRecommendations(userId: string, tracks: RecommendedTrack[]): Promise<void> {
  await redis.set(`user:${userId}:recs_cache`, JSON.stringify(tracks), { ex: 60 * 60 * 2 })
}

export async function clearRecommendationsCache(userId: string): Promise<void> {
  await redis.del(`user:${userId}:recs_cache`)
}
