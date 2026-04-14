import { cookies } from 'next/headers'

export interface Session {
  userId: string
}

const COOKIE_NAME = 'spotify_session'

export function encodeSession(session: Session): string {
  return Buffer.from(JSON.stringify(session)).toString('base64')
}

export function decodeSession(cookie: string): Session | null {
  try {
    return JSON.parse(Buffer.from(cookie, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const cookie = cookieStore.get(COOKIE_NAME)
  if (!cookie) return null
  return decodeSession(cookie.value)
}

export function buildSessionCookieHeader(session: Session): string {
  const value = encodeSession(session)
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
}
