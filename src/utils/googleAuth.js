/**
 * Returns a valid access token, refreshing silently if expired.
 * Returns null if no token stored or refresh fails.
 */
export async function getValidToken() {
  const raw = localStorage.getItem('google_oauth')
  if (!raw) return null

  let oauth
  try { oauth = JSON.parse(raw) } catch { return null }

  if (Date.now() < oauth.expires_at) return oauth.access_token

  // Token expired — try refresh
  try {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret || !oauth.refresh_token) return null

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: oauth.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    const data = await res.json()
    if (!data.access_token) return null

    const updated = {
      ...oauth,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
    }
    localStorage.setItem('google_oauth', JSON.stringify(updated))
    return data.access_token
  } catch {
    return null
  }
}

export function isConnected() {
  return !!localStorage.getItem('google_oauth')
}
