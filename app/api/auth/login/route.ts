import { NextResponse } from 'next/server'

const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-modify-playback-state',
  'user-read-playback-state',
].join(' ')

export function GET() {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SCOPES,
  })
  return NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  )
}
