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
        setMessage(
          err.error === 'Unauthorized'
            ? 'Sesión expirada, recarga la página.'
            : 'Abre Spotify en algún dispositivo primero, luego intenta de nuevo.'
        )
        return
      }
      const data = await res.json()
      setLastTracks(data.tracks)
      setMessage('✓ Agregadas a tu cola de Spotify')
    } catch {
      setMessage('Error de conexión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <button
        onClick={discover}
        disabled={loading}
        className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-4 px-10 rounded-full text-xl transition-colors w-full max-w-sm"
      >
        {loading ? 'Buscando...' : '🔀 Seguir descubriendo'}
      </button>

      {message && (
        <p className={`font-medium text-sm ${message.startsWith('✓') ? 'text-green-400' : 'text-yellow-400'}`}>
          {message}
        </p>
      )}

      {lastTracks.length > 0 && (
        <div className="w-full">
          <p className="text-zinc-500 text-xs mb-2">Recién agregadas a tu cola:</p>
          <ul className="space-y-2">
            {lastTracks.map((track) => (
              <li key={track.id} className="flex items-center gap-3 bg-zinc-800 rounded-lg p-3 animate-fade-in">
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
