'use client'

import { useState } from 'react'

interface Track {
  id: string
  name: string
  artist: string
  artistIsNew: boolean
  albumArt: string
}

const AVG_SONG_MINUTES = 3.5
const MAX_HOURS = 8

function songsForHours(hours: number): number {
  return Math.max(1, Math.round((hours * 60) / AVG_SONG_MINUTES))
}

export default function DiscoverButton() {
  const [loading, setLoading] = useState(false)
  const [tracks, setTracks] = useState<Track[]>([])
  const [message, setMessage] = useState('')
  const [hours, setHours] = useState(1)
  const [playlistId, setPlaylistId] = useState<string | null>(null)

  const count = songsForHours(hours)
  const displayTime = hours < 1
    ? `${Math.round(hours * 60)} min`
    : hours === 1 ? '1 hora' : `${hours} horas`

  async function discover() {
    setLoading(true)
    setMessage('Buscando canciones...')
    setTracks([])
    setPlaylistId(null)

    try {
      const res = await fetch(`/api/discover?count=${count}`)
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setMessage(
          data.error === 'Unauthorized'
            ? 'Sesión expirada, recarga la página.'
            : `Error: ${data.error ?? 'desconocido'}`
        )
        return
      }

      if (!data.tracks?.length) {
        setMessage('No se encontraron canciones nuevas. Intenta de nuevo.')
        return
      }

      setTracks(data.tracks)

      if (data.method === 'playlist' && data.playlistId) {
        setPlaylistId(data.playlistId)
        setMessage(`✓ ${data.tracks.length} canciones listas en "🔀 Descubrir Ahora"`)
      } else if (data.method === 'queue') {
        setMessage(`✓ ${data.tracks.length} canciones en tu cola (≈ ${displayTime})`)
      } else {
        setMessage(`✓ ${data.tracks.length} canciones encontradas`)
      }
    } catch {
      setMessage('Error de conexión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 w-full">

      {/* Hours selector */}
      <div className="w-full">
        <p className="text-zinc-400 text-sm mb-3 text-center">¿Cuántas horas quieres descubrir?</p>

        <div className="flex items-center gap-3 justify-center">
          <button
            onClick={() => setHours(h => Math.max(0.5, Math.round((h - 0.5) * 2) / 2))}
            disabled={loading || hours <= 0.5}
            className="w-9 h-9 rounded-full bg-zinc-800 text-white font-bold text-lg hover:bg-zinc-700 disabled:opacity-30 transition-colors"
          >−</button>

          <div className="text-center min-w-[120px]">
            <span className="text-3xl font-bold text-white">{displayTime}</span>
            <p className="text-zinc-500 text-xs mt-1">≈ {count} canciones</p>
          </div>

          <button
            onClick={() => setHours(h => Math.min(MAX_HOURS, Math.round((h + 0.5) * 2) / 2))}
            disabled={loading || hours >= MAX_HOURS}
            className="w-9 h-9 rounded-full bg-zinc-800 text-white font-bold text-lg hover:bg-zinc-700 disabled:opacity-30 transition-colors"
          >+</button>
        </div>

        {/* Quick presets */}
        <div className="flex gap-2 justify-center mt-3 flex-wrap">
          {[0.5, 1, 2, 3, 4].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              disabled={loading}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                hours === h ? 'bg-green-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {h < 1 ? '30m' : `${h}h`}
            </button>
          ))}
        </div>
      </div>

      {/* Main button */}
      <button
        onClick={discover}
        disabled={loading}
        className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-4 px-10 rounded-full text-xl transition-colors w-full max-w-sm"
      >
        {loading ? 'Buscando canciones...' : '🔀 Descubrir ahora'}
      </button>

      {message && (
        <div className="text-center">
          <p className={`font-medium text-sm ${
            message.startsWith('✓') ? 'text-green-400' :
            message.startsWith('Buscando') ? 'text-zinc-400' : 'text-yellow-400'
          }`}>
            {message}
          </p>
          {playlistId && message.startsWith('✓') && (
            <a
              href={`https://open.spotify.com/playlist/${playlistId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-500 underline text-xs mt-1 inline-block"
            >
              Abrir playlist en Spotify →
            </a>
          )}
        </div>
      )}

      {tracks.length > 0 && (
        <div className="w-full">
          <p className="text-zinc-500 text-xs mb-2">
            {playlistId ? 'En tu playlist' : 'En tu cola'} ({tracks.length} canciones):
          </p>
          <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {tracks.map((track) => (
              <li key={track.id} className="flex items-center gap-3 bg-zinc-800 rounded-lg p-3">
                {track.albumArt && (
                  <img src={track.albumArt} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
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
        </div>
      )}
    </div>
  )
}
