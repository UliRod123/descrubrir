# Spotify Discovery App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js web app that generates a daily Spotify discovery playlist and lets the user keep discovering songs infinitely via a "Seguir descubriendo" button that adds songs to their Spotify queue.

**Architecture:** Next.js 14 App Router deployed on Vercel. Auth uses Spotify OAuth 2.0 (Authorization Code Flow). Tokens and recommendation history are persisted in Vercel KV (Redis). A Vercel cron job refreshes the playlist daily at 8am UTC.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Vercel KV (@vercel/kv), Spotify Web API, Vercel Cron

---

## File Map

| File | Responsibility |
|------|---------------|
| `app/page.tsx` | Login screen — Spotify connect button |
| `app/dashboard/page.tsx` | Main dashboard — daily playlist + discover button |
| `app/api/auth/login/route.ts` | Redirects to Spotify OAuth |
| `app/api/auth/callback/route.ts` | Exchanges code for tokens, saves to KV, sets session cookie |
| `app/api/discover/route.ts` | Generates N songs, adds to Spotify queue, returns track list |
| `app/api/cron/daily/route.ts` | Generates 30-song playlist, creates/updates Spotify playlist |
| `lib/spotify.ts` | Spotify API client with auto token refresh |
| `lib/recommendations.ts` | Core recommendation algorithm (Pool A + Pool B merge) |
| `lib/kv.ts` | Vercel KV helpers (tokens, recommended set, playlist ID) |
| `lib/session.ts` | Session cookie read/write helpers |
| `vercel.json` | Cron schedule config |
| `.env.local` | Environment variables |

---

## Task 1: Project Setup

**Files:**
- Create: `package.json` (via create-next-app)
- Create: `.env.local`
- Create: `vercel.json`

- [ ] **Step 1: Scaffold Next.js project**

```bash
cd "C:/Users/pumas/OneDrive/Escritorio/Proyectos/spotify"
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --yes
```

Expected: Project files created in current directory.

- [ ] **Step 2: Install Vercel KV**

```bash
npm install @vercel/kv
```

- [ ] **Step 3: Create `.env.local`**

```bash
cat > .env.local << 'EOF'
SPOTIFY_CLIENT_ID=REPLACE_ME
SPOTIFY_CLIENT_SECRET=REPLACE_ME
SPOTIFY_REDIRECT_URI=http://localhost:3000/api/auth/callback
NEXTAUTH_SECRET=REPLACE_WITH_RANDOM_32_CHAR_STRING
KV_REST_API_URL=REPLACE_AFTER_VERCEL_KV_SETUP
KV_REST_API_TOKEN=REPLACE_AFTER_VERCEL_KV_SETUP
EOF
```

> Note: Get `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from https://developer.spotify.com/dashboard — create a new app, set redirect URI to `http://localhost:3000/api/auth/callback`.
> Generate `NEXTAUTH_SECRET` with: `openssl rand -base64 32`

- [ ] **Step 4: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/daily",
      "schedule": "0 8 * * *"
    }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git init
git add .
git commit -m "feat: initial Next.js project setup with Vercel KV"
```

---

## Task 2: KV Helpers

**Files:**
- Create: `lib/kv.ts`

- [ ] **Step 1: Write `lib/kv.ts`**

```typescript
import { kv } from '@vercel/kv'

export interface SpotifyTokens {
  access_token: string
  refresh_token: string
  expires_at: number // unix ms
}

export async function saveTokens(userId: string, tokens: SpotifyTokens): Promise<void> {
  await kv.set(`user:${userId}:tokens`, JSON.stringify(tokens))
}

export async function getTokens(userId: string): Promise<SpotifyTokens | null> {
  const raw = await kv.get<string>(`user:${userId}:tokens`)
  if (!raw) return null
  return typeof raw === 'string' ? JSON.parse(raw) : raw as SpotifyTokens
}

export async function savePlaylistId(userId: string, playlistId: string): Promise<void> {
  await kv.set(`user:${userId}:playlistId`, playlistId)
}

export async function getPlaylistId(userId: string): Promise<string | null> {
  return kv.get<string>(`user:${userId}:playlistId`)
}

export async function addRecommended(userId: string, trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return
  await kv.sadd(`user:${userId}:recommended`, ...trackIds)
  // TTL 30 days
  await kv.expire(`user:${userId}:recommended`, 60 * 60 * 24 * 30)
}

export async function isRecommended(userId: string, trackId: string): Promise<boolean> {
  return (await kv.sismember(`user:${userId}:recommended`, trackId)) === 1
}

export async function filterOutRecommended(userId: string, trackIds: string[]): Promise<string[]> {
  const results = await Promise.all(trackIds.map(id => isRecommended(userId, id)))
  return trackIds.filter((_, i) => !results[i])
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/kv.ts
git commit -m "feat: Vercel KV helpers for tokens and recommendation history"
```

---

## Task 3: Session Helpers

**Files:**
- Create: `lib/session.ts`

- [ ] **Step 1: Write `lib/session.ts`**

```typescript
import { cookies } from 'next/headers'

export interface Session {
  userId: string
}

const COOKIE_NAME = 'spotify_session'
const SECRET = process.env.NEXTAUTH_SECRET!

export function encodeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64')
  // Simple HMAC-less encoding — userId is not secret, just opaque
  return payload
}

export function decodeSession(cookie: string): Session | null {
  try {
    return JSON.parse(Buffer.from(cookie, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const cookie = cookieStore.get(COOKIE_NAME)
  if (!cookie) return null
  return decodeSession(cookie.value)
}

export function setSessionCookie(response: Response, session: Session): Response {
  const value = encodeSession(session)
  const headers = new Headers(response.headers)
  headers.append(
    'Set-Cookie',
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  )
  return new Response(response.body, { status: response.status, headers })
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/session.ts
git commit -m "feat: session cookie helpers"
```

---

## Task 4: Spotify API Client

**Files:**
- Create: `lib/spotify.ts`

- [ ] **Step 1: Write `lib/spotify.ts`**

```typescript
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

export async function getTopArtists(userId: string, timeRange: 'short_term' | 'long_term'): Promise<SpotifyArtist[]> {
  const data = await spotifyFetch<{ items: SpotifyArtist[] }>(
    userId,
    `/me/top/artists?time_range=${timeRange}&limit=20`
  )
  return data.items
}

export async function getRecentlyPlayedTrackIds(userId: string): Promise<Set<string>> {
  const data = await spotifyFetch<{ items: { track: { id: string } }[] }>(
    userId,
    '/me/player/recently-played?limit=50'
  )
  return new Set(data.items.map(i => i.track.id))
}

export async function getArtistAlbums(userId: string, artistId: string): Promise<string[]> {
  const data = await spotifyFetch<{ items: { id: string }[] }>(
    userId,
    `/artists/${artistId}/albums?include_groups=album,single&market=US&limit=10`
  )
  return data.items.map(a => a.id)
}

export async function getAlbumTracks(userId: string, albumId: string): Promise<SpotifyTrack[]> {
  const data = await spotifyFetch<{ items: SpotifyTrack[] }>(
    userId,
    `/albums/${albumId}/tracks?limit=50`
  )
  // Album tracks don't include album art — fetch minimal info
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
    `/artists/${artistId}/top-tracks?market=US`
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

export async function createPlaylist(userId: string, spotifyUserId: string, name: string): Promise<string> {
  const data = await spotifyFetch<{ id: string }>(
    userId,
    `/users/${spotifyUserId}/playlists`,
    {
      method: 'POST',
      body: JSON.stringify({ name, public: true, description: 'Tu discovery diario — generado automáticamente' }),
    }
  )
  return data.id
}

export async function replacePlaylistTracks(userId: string, playlistId: string, uris: string[]): Promise<void> {
  await spotifyFetch(userId, `/playlists/${playlistId}/tracks`, {
    method: 'PUT',
    body: JSON.stringify({ uris }),
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/spotify.ts
git commit -m "feat: Spotify API client with auto token refresh"
```

---

## Task 5: Recommendation Engine

**Files:**
- Create: `lib/recommendations.ts`

- [ ] **Step 1: Write `lib/recommendations.ts`**

```typescript
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
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
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

export async function getRecommendations(userId: string, count: number): Promise<RecommendedTrack[]> {
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
        albumIds.slice(0, 3).map(id => getAlbumTracks(userId, id))
      )
      return trackArrays.flat().filter(t => t.id && !recentIds.has(t.id))
    } catch {
      return []
    }
  })
  const poolANested = await Promise.all(poolAPromises)
  const poolARaw = poolANested.flat()

  const poolAIds = await filterOutRecommended(userId, poolARaw.map(t => t.id))
  const poolAIdSet = new Set(poolAIds)
  const poolA = poolARaw.filter(t => poolAIdSet.has(t.id))

  // Pool B: top tracks from related (new) artists
  const relatedPromises = knownArtists.slice(0, 5).map(a => getRelatedArtists(userId, a.id))
  const relatedNested = await Promise.all(relatedPromises.map(p => p.catch(() => [])))
  const allRelated = relatedNested.flat()
  const newArtists = allRelated.filter(a => !knownArtistIds.has(a.id))
  const uniqueNewArtists = Array.from(new Map(newArtists.map(a => [a.id, a])).values()).slice(0, 15)

  const poolBPromises = uniqueNewArtists.map(async (artist) => {
    try {
      return await getArtistTopTracks(userId, artist.id)
    } catch {
      return []
    }
  })
  const poolBNested = await Promise.all(poolBPromises)
  const poolBRaw = poolBNested.flat().filter(t => t.id && !recentIds.has(t.id))

  const poolBIds = await filterOutRecommended(userId, poolBRaw.map(t => t.id))
  const poolBIdSet = new Set(poolBIds)
  const poolB = poolBRaw.filter(t => poolBIdSet.has(t.id))

  // Mix 50/50
  const half = Math.ceil(count / 2)
  const selectedA = shuffle(poolA).slice(0, half).map(t => toRecommended(t, false))
  const selectedB = shuffle(poolB).slice(0, count - selectedA.length).map(t => toRecommended(t, true))

  const combined = shuffle([...selectedA, ...selectedB])

  // Save to history so they don't repeat
  await addRecommended(userId, combined.map(t => t.id))

  return combined
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/recommendations.ts
git commit -m "feat: recommendation engine with Pool A (known artists) + Pool B (new artists)"
```

---

## Task 6: Auth Routes

**Files:**
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/callback/route.ts`

- [ ] **Step 1: Create `app/api/auth/login/route.ts`**

```typescript
import { NextResponse } from 'next/server'

const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'playlist-modify-public',
  'user-modify-playback-state',
].join(' ')

export function GET() {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SCOPES,
  })
  return NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  )
}
```

- [ ] **Step 2: Create `app/api/auth/callback/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { saveTokens } from '@/lib/kv'
import { setSessionCookie } from '@/lib/session'
import { getCurrentUserId } from '@/lib/spotify'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/?error=no_code', req.url))

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    }),
  })

  if (!res.ok) return NextResponse.redirect(new URL('/?error=token_exchange', req.url))

  const data = await res.json()
  // We need a stable userId — use Spotify's user ID
  // Temporarily store tokens to fetch /me
  const tempUserId = 'temp_' + Date.now()
  await saveTokens(tempUserId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  })

  const spotifyUserId = await getCurrentUserId(tempUserId)

  await saveTokens(spotifyUserId, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  })

  const redirect = NextResponse.redirect(new URL('/dashboard', req.url))
  const withCookie = setSessionCookie(redirect, { userId: spotifyUserId })
  return withCookie
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/auth/
git commit -m "feat: Spotify OAuth login and callback routes"
```

---

## Task 7: Discover API Route

**Files:**
- Create: `app/api/discover/route.ts`

- [ ] **Step 1: Create `app/api/discover/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRecommendations } from '@/lib/recommendations'
import { addToQueue } from '@/lib/spotify'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = parseInt(req.nextUrl.searchParams.get('count') ?? '10', 10)

  const tracks = await getRecommendations(session.userId, count)

  // Add all to Spotify queue sequentially (API requires one at a time)
  for (const track of tracks) {
    try {
      await addToQueue(session.userId, track.uri)
    } catch {
      // If no active device, queue fails silently — tracks still returned to UI
    }
  }

  return NextResponse.json({ tracks })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/discover/route.ts
git commit -m "feat: /api/discover endpoint — generates recommendations and adds to Spotify queue"
```

---

## Task 8: Daily Cron Route

**Files:**
- Create: `app/api/cron/daily/route.ts`

- [ ] **Step 1: Create `app/api/cron/daily/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { kv } from '@vercel/kv'
import { getRecommendations } from '@/lib/recommendations'
import { createPlaylist, replacePlaylistTracks, getCurrentUserId } from '@/lib/spotify'
import { getPlaylistId, savePlaylistId } from '@/lib/kv'

export async function POST(req: NextRequest) {
  // Vercel cron sends this header — verify it
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get all user IDs that have tokens stored
  const keys: string[] = await kv.keys('user:*:tokens')
  const userIds = keys.map(k => k.split(':')[1]).filter(Boolean)

  const results = []
  for (const userId of userIds) {
    try {
      const tracks = await getRecommendations(userId, 30)
      const uris = tracks.map(t => t.uri)

      let playlistId = await getPlaylistId(userId)
      if (!playlistId) {
        const spotifyUserId = await getCurrentUserId(userId)
        playlistId = await createPlaylist(userId, spotifyUserId, '🎵 Discovery Diario')
        await savePlaylistId(userId, playlistId)
      }

      await replacePlaylistTracks(userId, playlistId, uris)
      results.push({ userId, success: true, count: tracks.length })
    } catch (err) {
      results.push({ userId, success: false, error: String(err) })
    }
  }

  return NextResponse.json({ results })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/cron/daily/route.ts
git commit -m "feat: daily cron route — refreshes Discovery Diario playlist for all users"
```

---

## Task 9: Login Page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-2">Discovery Diario</h1>
        <p className="text-zinc-400 text-lg">Descubre canciones nuevas cada día — sin repetir lo mismo.</p>
      </div>
      <a
        href="/api/auth/login"
        className="bg-green-500 hover:bg-green-400 text-black font-bold py-3 px-8 rounded-full text-lg transition-colors"
      >
        Conectar con Spotify
      </a>
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: login page with Spotify connect button"
```

---

## Task 10: Dashboard Page

**Files:**
- Create: `app/dashboard/page.tsx`
- Create: `app/dashboard/DiscoverButton.tsx`

- [ ] **Step 1: Create `app/dashboard/DiscoverButton.tsx` (client component)**

```tsx
'use client'

import { useState } from 'react'

interface Track {
  id: string
  name: string
  artist: string
  artistIsNew: boolean
  albumArt: string
}

export default function DiscoverButton() {
  const [loading, setLoading] = useState(false)
  const [lastTracks, setLastTracks] = useState<Track[]>([])
  const [message, setMessage] = useState('')

  async function discover() {
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch('/api/discover?count=10')
      if (!res.ok) {
        const err = await res.json()
        setMessage(err.error === 'Unauthorized' ? 'Sesión expirada, recarga la página.' : 'Error al obtener canciones.')
        return
      }
      const data = await res.json()
      setLastTracks(data.tracks)
      setMessage('Agregadas a tu cola de Spotify ✓')
    } catch {
      setMessage('Error de conexión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xl">
      <button
        onClick={discover}
        disabled={loading}
        className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-4 px-10 rounded-full text-xl transition-colors w-full"
      >
        {loading ? 'Buscando...' : '🔀 Seguir descubriendo'}
      </button>

      {message && (
        <p className="text-green-400 font-medium">{message}</p>
      )}

      {lastTracks.length > 0 && (
        <ul className="w-full space-y-2">
          {lastTracks.map(track => (
            <li key={track.id} className="flex items-center gap-3 bg-zinc-800 rounded-lg p-3">
              {track.albumArt && (
                <img src={track.albumArt} alt="" className="w-10 h-10 rounded object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{track.name}</p>
                <p className="text-zinc-400 text-sm truncate">{track.artist}</p>
              </div>
              {track.artistIsNew && (
                <span className="text-xs bg-green-500 text-black font-bold px-2 py-1 rounded-full shrink-0">
                  NUEVO
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `app/dashboard/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getRecommendations } from '@/lib/recommendations'
import { getPlaylistId } from '@/lib/kv'
import DiscoverButton from './DiscoverButton'

export default async function Dashboard() {
  const session = await getSession()
  if (!session) redirect('/')

  let tracks: Awaited<ReturnType<typeof getRecommendations>> = []
  let playlistId: string | null = null

  try {
    tracks = await getRecommendations(session.userId, 30)
    playlistId = await getPlaylistId(session.userId)
  } catch {
    // Show dashboard even if recommendations fail
  }

  return (
    <main className="min-h-screen bg-black text-white p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">🎵 Discovery Diario</h1>
        <p className="text-zinc-400 mt-1">Tu playlist de hoy — canciones que nunca has escuchado</p>
        {playlistId && (
          <a
            href={`https://open.spotify.com/playlist/${playlistId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-400 text-sm hover:underline mt-1 block"
          >
            Ver en Spotify →
          </a>
        )}
      </div>

      <div className="mb-8 flex justify-center">
        <DiscoverButton />
      </div>

      {tracks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3 text-zinc-300">Playlist del día ({tracks.length} canciones)</h2>
          <ul className="space-y-2">
            {tracks.map(track => (
              <li key={track.id} className="flex items-center gap-3 bg-zinc-900 rounded-lg p-3">
                {track.albumArt && (
                  <img src={track.albumArt} alt="" className="w-10 h-10 rounded object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{track.name}</p>
                  <p className="text-zinc-400 text-sm truncate">{track.artist}</p>
                </div>
                {track.artistIsNew && (
                  <span className="text-xs bg-green-500 text-black font-bold px-2 py-1 rounded-full shrink-0">
                    NUEVO
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/
git commit -m "feat: dashboard page with daily playlist and Seguir descubriendo button"
```

---

## Task 11: Deploy to Vercel

**Files:**
- No code changes — deploy and configure

- [ ] **Step 1: Create Spotify Developer App**

1. Go to https://developer.spotify.com/dashboard
2. Click "Create App"
3. Name: "Discovery Diario", redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback`
4. Copy Client ID and Client Secret

- [ ] **Step 2: Push to GitHub**

```bash
gh repo create spotify-discovery --public --source=. --push
```

- [ ] **Step 3: Deploy to Vercel**

```bash
npx vercel --yes
```

Note the deployment URL (e.g. `https://spotify-discovery-xxx.vercel.app`).

- [ ] **Step 4: Connect Vercel KV**

In Vercel dashboard → Storage → Create KV Database → Link to your project.
This auto-populates `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars.

- [ ] **Step 5: Set environment variables in Vercel**

```bash
npx vercel env add SPOTIFY_CLIENT_ID
npx vercel env add SPOTIFY_CLIENT_SECRET
npx vercel env add SPOTIFY_REDIRECT_URI
# value: https://YOUR-APP.vercel.app/api/auth/callback
npx vercel env add NEXTAUTH_SECRET
# value: run `openssl rand -base64 32`
```

- [ ] **Step 6: Redeploy with env vars**

```bash
npx vercel --prod
```

- [ ] **Step 7: Update Spotify app redirect URI**

In Spotify Developer Dashboard, add your production URL:
`https://YOUR-APP.vercel.app/api/auth/callback`

---

## Task 12: End-to-End Verification

- [ ] **Step 1: Test login flow**

Open `https://YOUR-APP.vercel.app` → click "Conectar con Spotify" → should redirect to Spotify, then back to `/dashboard`.

- [ ] **Step 2: Verify dashboard loads**

Dashboard should show 30 recommended tracks. Some should have "NUEVO" badge.

- [ ] **Step 3: Test "Seguir descubriendo"**

Click "Seguir descubriendo" while Spotify is playing on any device → check that new songs appear in queue. Message "Agregadas a tu cola de Spotify ✓" should show.

- [ ] **Step 4: Test cron manually**

```bash
curl -X POST https://YOUR-APP.vercel.app/api/cron/daily \
  -H "Authorization: Bearer $(vercel env pull --yes && grep CRON_SECRET .env | cut -d= -f2)"
```

Expected: `{"results":[{"userId":"...","success":true,"count":30}]}`
Check Spotify — playlist "🎵 Discovery Diario" should appear.

- [ ] **Step 5: Verify anti-repeat**

Click "Seguir descubriendo" multiple times — songs should not repeat.

- [ ] **Step 6: Verify cron is scheduled**

In Vercel dashboard → Cron Jobs → confirm `0 8 * * *` job appears for `/api/cron/daily`.
