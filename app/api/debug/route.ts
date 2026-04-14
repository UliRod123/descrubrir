import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { spotifyFetch, getArtistTopTracks, getRelatedArtists } from '@/lib/spotify'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [short, medium, longTerm, recent] = await Promise.all([
      spotifyFetch<{ items: { id: string; name: string }[] }>(session.userId, '/me/top/artists?time_range=short_term&limit=5').catch(e => ({ error: String(e) })),
      spotifyFetch<{ items: { id: string; name: string }[] }>(session.userId, '/me/top/artists?time_range=medium_term&limit=5').catch(e => ({ error: String(e) })),
      spotifyFetch<{ items: { id: string; name: string }[] }>(session.userId, '/me/top/artists?time_range=long_term&limit=5').catch(e => ({ error: String(e) })),
      spotifyFetch<{ items: unknown[] }>(session.userId, '/me/player/recently-played?limit=5').catch(e => ({ error: String(e) })),
    ])

    // Test getArtistTopTracks on the first artist we find
    let topTracksTest: unknown = { skipped: 'no artists found' }
    let relatedTest: unknown = { skipped: 'no artists found' }
    const firstArtist = (short as { items?: { id: string; name: string }[] }).items?.[0]
      ?? (longTerm as { items?: { id: string; name: string }[] }).items?.[0]

    if (firstArtist) {
      topTracksTest = await getArtistTopTracks(session.userId, firstArtist.id)
        .then(tracks => ({ ok: true, artist: firstArtist.name, count: tracks.length, first: tracks[0]?.name }))
        .catch(e => ({ ok: false, artist: firstArtist.name, error: String(e) }))

      relatedTest = await getRelatedArtists(session.userId, firstArtist.id)
        .then(artists => ({ ok: true, artist: firstArtist.name, count: artists.length, first: artists[0]?.name }))
        .catch(e => ({ ok: false, artist: firstArtist.name, error: String(e) }))
    }

    return NextResponse.json({ userId: session.userId, short, medium, longTerm, recent, topTracksTest, relatedTest })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
