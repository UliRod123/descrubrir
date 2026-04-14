import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { getRecommendations } from '@/lib/recommendations'
import { addToQueue } from '@/lib/spotify'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = Math.min(
    parseInt(req.nextUrl.searchParams.get('count') ?? '10', 10),
    20
  )

  // skipCache=true so each button press gives fresh songs
  const tracks = await getRecommendations(session.userId, count, true)

  // Add to Spotify queue — fails silently if no active device
  for (const track of tracks) {
    try {
      await addToQueue(session.userId, track.uri)
    } catch {
      // No active device — tracks still returned so user can see what was picked
    }
  }

  return NextResponse.json({ tracks })
}
