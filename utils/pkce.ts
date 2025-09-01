import CryptoJS from 'crypto-js'

export function generateRandomString(length: number): string {
  // Use only unreserved characters that don't need URL encoding
  // Removed tilde (~) to avoid encoding issues
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._'
  let text = ''
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(codeVerifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const base64Digest = btoa(String.fromCharCode(...new Uint8Array(digest)))
  // Convert to URL-safe base64
  return base64Digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function generateState(): string {
  return generateRandomString(32)
}