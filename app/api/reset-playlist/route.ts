import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { redis } from '@/lib/kv'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await redis.del(`user:${session.userId}:discoverPlaylistId`)
  await redis.del(`user:${session.userId}:discoverPlaylistId_old`) // legacy key
  await redis.del(`user:${session.userId}:playlistId`)

  return NextResponse.json({ ok: true, message: 'Playlist ID cleared. Next discover will create a fresh playlist.' })
}
