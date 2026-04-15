import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRecommendations, getRecommendationsDiagnostics } from '@/lib/recommendations'
import { addToQueue } from '@/lib/spotify'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = Math.min(
    parseInt(req.nextUrl.searchParams.get('count') ?? '17', 10),
    100
  )

  let tracks
  try {
    tracks = await getRecommendations(session.userId, count, true)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  if (tracks.length === 0) {
    const diag = await getRecommendationsDiagnostics(session.userId).catch(e => ({ diagError: String(e) }))
    return NextResponse.json({ tracks: [], queuedCount: 0, method: 'none', diagnostics: diag })
  }

  const uris = tracks.map(t => t.uri).filter(u => u?.startsWith('spotify:track:'))

  // Add to queue in parallel batches of 10 — fast enough to stay within timeout
  const BATCH = 10
  let queuedCount = 0
  let lastError = ''

  for (let i = 0; i < uris.length; i += BATCH) {
    const batch = uris.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map(uri => addToQueue(session.userId, uri))
    )
    for (const r of results) {
      if (r.status === 'fulfilled') queuedCount++
      else lastError = String(r.reason)
    }
  }

  if (queuedCount === 0) {
    return NextResponse.json({
      tracks: [],
      queuedCount: 0,
      method: 'none',
      error: lastError || 'No se pudo agregar a la cola. Asegúrate de tener Spotify abierto y reproduciendo.',
    })
  }

  return NextResponse.json({ tracks: tracks.slice(0, queuedCount), queuedCount, method: 'queue' })
}
