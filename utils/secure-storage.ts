import { Storage } from "@plasmohq/storage"
import type { TokenResponse, UserInfo } from "~types/auth"

export class SecureTokenStorage {
  private storage = new Storage({ area: "session" })
  
  async storeTokens(tokens: TokenResponse): Promise<void> {
    await this.storage.set('access_token', tokens.access_token)
    if (tokens.refresh_token) {
      await this.storage.set('refresh_token', tokens.refresh_token)
    }
    if (tokens.id_token) {
      await this.storage.set('id_token', tokens.id_token)
    }
    const expiresAt = Date.now() + (tokens.expires_in * 1000)
    await this.storage.set('token_expiry', expiresAt)
  }
  
  async getAccessToken(): Promise<string | null> {
    console.log('[SecureStorage] Getting access token...')
    try {
      const token = await this.storage.get('access_token')
      const expiry = await this.storage.get('token_expiry')
      
      console.log('[SecureStorage] Token retrieved:', { hasToken: !!token, expiry, now: Date.now() })
      
      if (!token) return null
      
      // Check if token is expired (with 5 minute buffer)
      if (expiry && Date.now() > (expiry - 300000)) {
        console.log('[SecureStorage] Token expired, refreshing...')
        return await this.refreshAccessToken()
      }
      
      return token
    } catch (error) {
      console.error('[SecureStorage] Error getting access token:', error)
      return null
    }
  }
  
  async refreshAccessToken(): Promise<string | null> {
    const refreshToken = await this.storage.get('refresh_token')
    if (!refreshToken) return null
    
    try {
      // Use proxy for refresh token as well
      const API_ENDPOINT = process.env.PLASMO_PUBLIC_API_ENDPOINT!
      const TOKEN_PROXY_PATH = process.env.PLASMO_PUBLIC_API_TOKEN_PROXY_PATH!
      const proxyUrl = `${API_ENDPOINT}${TOKEN_PROXY_PATH}/refresh`
      
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: refreshToken
        })
      })
      
      if (!response.ok) {
        throw new Error('Token refresh failed')
      }
      
      const tokens: TokenResponse = await response.json()
      await this.storeTokens(tokens)
      return tokens.access_token
    } catch (error) {
      console.error('[Auth] Token refresh failed:', error)
      await this.clearTokens()
      return null
    }
  }
  
  async clearTokens(): Promise<void> {
    await this.storage.remove('access_token')
    await this.storage.remove('refresh_token')
    await this.storage.remove('id_token')
    await this.storage.remove('token_expiry')
    await this.storage.remove('user_info')
  }
  
  async storeUserInfo(userInfo: UserInfo): Promise<void> {
    await this.storage.set('user_info', userInfo)
  }
  
  async getUserInfo(): Promise<UserInfo | null> {
    return await this.storage.get('user_info')
  }
  
  async isAuthenticated(): Promise<boolean> {
    try {
      console.log('[SecureStorage] Checking authentication...')
      const token = await this.getAccessToken()
      console.log('[SecureStorage] Token exists:', token !== null)
      return token !== null
    } catch (error) {
      console.error('[SecureStorage] Error checking authentication:', error)
      return false
    }
  }
}