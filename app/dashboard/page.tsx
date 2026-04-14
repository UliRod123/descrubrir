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
  let error = ''

  try {
    ;[tracks, playlistId] = await Promise.all([
      getRecommendations(session.userId, 30),
      getPlaylistId(session.userId),
    ])
  } catch (e) {
    error = String(e)
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">🎵 Discovery Diario</h1>
          <p className="text-zinc-400 mt-1">Tu playlist de hoy — canciones que nunca has escuchado</p>
          {playlistId && (
            <a
              href={`https://open.spotify.com/playlist/${playlistId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 text-sm hover:underline mt-1 inline-block"
            >
              Ver playlist en Spotify →
            </a>
          )}
        </div>

        <div className="mb-8">
          <DiscoverButton />
        </div>

        {error && (
          <p className="text-red-400 text-sm mb-4">Error cargando recomendaciones: {error}</p>
        )}

        {tracks.length > 0 && (
          <section>
            <h2 className="text-base font-semibold mb-3 text-zinc-300">
              Playlist del día — {tracks.length} canciones
            </h2>
            <ul className="space-y-2">
              {tracks.map((track) => (
                <li
                  key={track.id}
                  className="flex items-center gap-3 bg-zinc-900 hover:bg-zinc-800 rounded-lg p-3 transition-colors"
                >
                  {track.albumArt && (
                    <img
                      src={track.albumArt}
                      alt=""
                      className="w-10 h-10 rounded object-cover shrink-0"
                    />
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
      </div>
    </main>
  )
}
