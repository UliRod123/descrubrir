'use client'

import { useState } from 'react'

interface Track {
  id: string
  name: string
  artist: string
  artistIsNew: boolean
  albumArt: string
}

type DiscoveryMode = 'mis-artistas' | 'ingles' | 'generos'

const AVG_SONG_MINUTES = 3.5
const MAX_HOURS = 8
// How many songs to add per API call — each call takes ~2-3s in parallel
const BATCH_SIZE = 17

function songsForHours(hours: number): number {
  return Math.max(1, Math.round((hours * 60) / AVG_SONG_MINUTES))
}

export default function DiscoverButton() {
  const [loading, setLoading] = useState(false)
  const [addedTracks, setAddedTracks] = useState<Track[]>([])
  const [message, setMessage] = useState('')
  const [hours, setHours] = useState(1)
  const [modes, setModes] = useState<DiscoveryMode[]>(['mis-artistas'])

  function toggleMode(mode: DiscoveryMode) {
    if (mode === 'mis-artistas') return // locked, cannot deselect
    setModes(prev =>
      prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode]
    )
  }

  const count = songsForHours(hours)
  const displayTime = hours < 1
    ? `${Math.round(hours * 60)} min`
    : hours === 1 ? '1 hora' : `${hours} horas`

  async function discover() {
    setLoading(true)
    setMessage('Agregando canciones a tu cola...')
    setAddedTracks([])

    const all: Track[] = []
    const batches = Math.ceil(count / BATCH_SIZE)

    for (let i = 0; i < batches; i++) {
      const remaining = count - all.length
      const thisBatch = Math.min(BATCH_SIZE, remaining)

      try {
        const res = await fetch(`/api/discover?count=${thisBatch}&modes=${modes.join(',')}`)
        const data = await res.json().catch(() => ({}))

        if (!res.ok || data.error) {
          if (all.length > 0) break // partial success — stop gracefully
          setMessage(data.error || 'Error desconocido')
          setLoading(false)
          return
        }

        if (data.tracks?.length) {
          all.push(...data.tracks)
          setAddedTracks([...all])
          setMessage(`⏳ ${all.length} de ${count} canciones en cola...`)
        }
      } catch {
        if (all.length > 0) break
        setMessage('Error de conexión.')
        setLoading(false)
        return
      }
    }

    setLoading(false)
    if (all.length === 0) {
      setMessage('Abre Spotify y pon algo a reproducir primero, luego intenta de nuevo.')
    } else {
      setMessage(`✓ ${all.length} canciones agregadas a tu cola de Spotify (≈ ${displayTime})`)
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

      {/* Discovery mode toggles */}
      <div className="w-full">
        <p className="text-zinc-400 text-sm mb-3 text-center">¿Qué quieres descubrir?</p>
        <div className="flex gap-2 justify-center flex-wrap">
          {/* mis-artistas: always selected, locked */}
          <button
            disabled={loading}
            onClick={() => toggleMode('mis-artistas')}
            className="px-4 py-2 rounded-full text-sm font-semibold transition-colors bg-green-500 text-black cursor-default"
            aria-pressed={true}
          >
            🎵 Tus artistas
          </button>
          <button
            disabled={loading}
            onClick={() => toggleMode('ingles')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              modes.includes('ingles') ? 'bg-green-500 text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
            aria-pressed={modes.includes('ingles')}
          >
            🇺🇸 Inglés
          </button>
          <button
            disabled={loading}
            onClick={() => toggleMode('generos')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              modes.includes('generos') ? 'bg-green-500 text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
            aria-pressed={modes.includes('generos')}
          >
            🎭 Géneros mix
          </button>
        </div>
      </div>

      {/* Main button */}
      <button
        onClick={discover}
        disabled={loading}
        className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-black font-bold py-4 px-10 rounded-full text-xl transition-colors w-full max-w-sm"
      >
        {loading
          ? `Agregando... (${addedTracks.length}/${count})`
          : '🔀 Descubrir ahora'}
      </button>

      {message && (
        <p className={`text-sm text-center font-medium ${
          message.startsWith('✓') ? 'text-green-400' :
          message.startsWith('⏳') ? 'text-zinc-400' : 'text-yellow-400'
        }`}>
          {message}
        </p>
      )}

      {addedTracks.length > 0 && (
        <div className="w-full">
          <p className="text-zinc-500 text-xs mb-2">En tu cola ({addedTracks.length} canciones):</p>
          <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {addedTracks.map((track) => (
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
