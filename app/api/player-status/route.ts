import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { spotifyFetch } from '@/lib/spotify'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [player, devices] = await Promise.all([
    spotifyFetch<{
      is_playing: boolean
      device: { name: string; type: string; id: string }
      item: { name: string; artists: { name: string }[] }
    }>(session.userId, '/me/player').catch(() => null),
    spotifyFetch<{ devices: { id: string; name: string; type: string; is_active: boolean }[] }>(
      session.userId, '/me/player/devices'
    ).catch(() => null),
  ])

  return NextResponse.json({
    isPlaying: player?.is_playing ?? false,
    currentDevice: player?.device?.name ?? null,
    currentTrack: player?.item ? `${player.item.name} — ${player.item.artists[0]?.name}` : null,
    allDevices: devices?.devices?.map(d => ({ name: d.name, type: d.type, active: d.is_active })) ?? [],
  })
}
