export default function Home() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-3">🎵 Discovery Diario</h1>
        <p className="text-zinc-400 text-lg max-w-md">
          Descubre canciones nuevas cada día — de tus artistas favoritos y artistas similares que no conoces.
        </p>
      </div>
      <a
        href="/api/auth/login"
        className="bg-green-500 hover:bg-green-400 text-black font-bold py-3 px-10 rounded-full text-lg transition-colors"
      >
        Conectar con Spotify
      </a>
    </main>
  )
}
