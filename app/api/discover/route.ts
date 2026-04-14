import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRecommendations } from '@/lib/recommendations'
import { addToQueue } from '@/lib/spotify'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = Math.min(
    parseInt(req.nextUrl.searchParams.get('count') ?? '10', 10),
    100
  )

  let tracks
  try {
    // skipCache=true so each button press gives fresh songs
    tracks = await getRecommendations(session.userId, count, true)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  // Add to Spotify queue — fails silently if no active device
  let queuedCount = 0
  for (const track of tracks) {
    try {
      await addToQueue(session.userId, track.uri)
      queuedCount++
    } catch {
      // No active device — tracks still returned so user can see what was picked
    }
  }

  return NextResponse.json({ tracks, queuedCount })
}
