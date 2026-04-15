import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { clearRecommendedHistory, clearRecommendationsCache } from '@/lib/kv'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await Promise.all([
    clearRecommendedHistory(session.userId),
    clearRecommendationsCache(session.userId),
  ])

  return NextResponse.json({ ok: true, message: 'Historial limpiado. Ahora descubrirás canciones frescas.' })
}
