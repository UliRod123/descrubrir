'use client'

import { useState } from 'react'

interface Track {
  id: string
  name: string
  artist: string
  artistIsNew: boolean
  albumArt: string
}

const TIME_OPTIONS = [
  { label: '30 min', hours: 0.5 },
  { label: '1 hora', hours: 1 },
  { label: '2 horas', hours: 2 },
  { label: '3 horas', hours: 3 },
  { label: '4 horas', hours: 4 },
]

const AVG_SONG_MINUTES = 3.5

function songsForHours(hours: number): number {
  return Math.round((hours * 60) / AVG_SONG_MINUTES)
}

export default function DiscoverButton() {
  const [loading, setLoading] = useState(false)
  const [lastTracks, setLastTracks] = useState<Track[]>([])
  const [message, setMessage] = useState('')
  const [selectedHours, setSelectedHours] = useState(1)

  const count = songsForHours(selectedHours)

  async function discover() {
    setLoading(true)
    setMessage('')
    setLastTracks([])

    // For large counts, fetch in batches of 17 to avoid rate limits
    const batchSize = 17
    const batches = Math.ceil(count / batchSize)
    const allTracks: Track[] = []

    for (let i = 0; i < batches; i++) {
      const remaining = count - allTracks.length
      const thisBatch = Math.min(batchSize, remaining)
      try {
        const res = await fetch(`/api/discover?count=${thisBatch}`)
        if (!res.ok) {
          const err = await res.json()
          setMessage(
            err.error === 'Unauthorized'
              ? 'Sesión expirada, recarga la página.'
              : 'Abre Spotify en algún dispositivo primero, luego intenta de nuevo.'
          )
          setLoading(false)
          return
        }
        const data = await res.json()
        allTracks.push(...data.tracks)
        // Show progress as batches come in
        setLastTracks([...allTracks])
        setMessage(`✓ ${allTracks.length} de ${count} canciones agregadas...`)
      } catch {
        setMessage('Error de conexión.')
        setLoading(false)
        return
      }
    }

    setMessage(`✓ ${allTracks.length} canciones agregadas a tu cola (~${selectedHours >= 1 ? selectedHours + (selectedHours === 1 ? ' hora' : ' horas') : '30 min'} de música)`)
    setLoading(false)
  }

  return (
    <div className="flex flex-col items-center gap-5 w-full">

      {/* Time selector */}
      <div className="w-full">
        <p className="text-zinc-400 text-sm mb-3 text-center">¿Cuánto tiempo quieres descubrir?</p>
        <div className="flex gap-2 justify-center flex-wrap">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.hours}
              onClick={() => setSelectedHours(opt.hours)}
              disabled={loading}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                selectedHours === opt.hours
                  ? 'bg-green-500 text-black'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-zinc-600 text-xs text-center mt-2">
          ≈ {count} canciones
        </p>
      </div>

      {/* Main button */}
      <button
        onClick={discover}
        disabled={loading}
        className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-4 px-10 rounded-full text-xl transition-colors w-full max-w-sm"
      >
        {loading ? `Cargando... (${lastTracks.length}/${count})` : '🔀 Descubrir ahora'}
      </button>

      {message && (
        <p className={`font-medium text-sm text-center ${message.startsWith('✓') ? 'text-green-400' : 'text-yellow-400'}`}>
          {message}
        </p>
      )}

      {lastTracks.length > 0 && (
        <div className="w-full">
          <p className="text-zinc-500 text-xs mb-2">Agregadas a tu cola ({lastTracks.length}):</p>
          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {lastTracks.map((track) => (
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
