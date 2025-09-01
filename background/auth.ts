import { SecureTokenStorage } from "~utils/secure-storage"
import { generateRandomString, generateCodeChallenge, generateState } from "~utils/pkce"
import type { TokenResponse, UserInfo } from "~types/auth"

export class OktaAuth {
  private storage = new SecureTokenStorage()
  private pendingState: string | null = null
  private pendingVerifier: string | null = null
  
  async initiateLogin(): Promise<void> {
    const CLIENT_ID = process.env.PLASMO_PUBLIC_OKTA_CLIENT_ID!
    const OKTA_DOMAIN = process.env.PLASMO_PUBLIC_OKTA_DOMAIN!
    const USE_DEFAULT_AS = process.env.PLASMO_PUBLIC_OKTA_USE_DEFAULT_AS === 'true'
    
    // Log configuration for debugging
    const redirectUri = chrome.identity.getRedirectURL()
    console.log('[Auth] Configuration:', {
      CLIENT_ID,
      OKTA_DOMAIN,
      redirectUri,
      extensionId: chrome.runtime.id,
      useDefaultAS: USE_DEFAULT_AS
    })
    
    // Generate PKCE parameters
    const codeVerifier = generateRandomString(128)
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = generateState()
    
    // Store for later use
    this.pendingVerifier = codeVerifier
    this.pendingState = state
    
    // Build authorization URL (with optional default authorization server)
    const authPath = USE_DEFAULT_AS ? '/oauth2/default/v1/authorize' : '/oauth2/v1/authorize'
    const authUrl = new URL(`https://${OKTA_DOMAIN}${authPath}`)
    authUrl.searchParams.set('client_id', CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', 'openid profile email offline_access')
    
    // Always use PKCE (required by Okta for browser-based flows)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('prompt', 'login') // Force login page to show
    
    console.log('[Auth] Authorization URL:', authUrl.href)
    
    // Launch OAuth flow
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.href,
        interactive: true
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          console.error('[Auth] Login failed:', chrome.runtime.lastError?.message || 'No redirect URL')
          console.error('[Auth] Full error:', JSON.stringify(chrome.runtime.lastError, null, 2))
          console.error('[Auth] Make sure this redirect URI is added to your Okta app:', redirectUri)
          console.error('[Auth] Auth URL was:', authUrl.href)
          return
        }
        
        await this.handleAuthCallback(redirectUrl)
      }
    )
  }
  
  private async handleAuthCallback(redirectUrl: string): Promise<void> {
    const url = new URL(redirectUrl)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')
    
    if (error) {
      console.error('[Auth] OAuth error:', error)
      return
    }
    
    if (state !== this.pendingState) {
      console.error('[Auth] State mismatch - possible CSRF attack')
      return
    }
    
    if (!code || !this.pendingVerifier) {
      console.error('[Auth] Missing code or verifier')
      return
    }
    
    await this.exchangeCodeForTokens(code, this.pendingVerifier)
  }
  
  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<void> {
    const API_ENDPOINT = process.env.PLASMO_PUBLIC_API_ENDPOINT!
    const TOKEN_PROXY_PATH = process.env.PLASMO_PUBLIC_API_TOKEN_PROXY_PATH!
    const redirectUri = chrome.identity.getRedirectURL()
    
    // Use backend proxy to exchange tokens
    const proxyUrl = `${API_ENDPOINT}${TOKEN_PROXY_PATH}`
    
    console.log('[Auth] Using proxy for token exchange:', {
      proxyUrl,
      redirectUri,
      codePresent: !!code,
      codeVerifierPresent: !!codeVerifier
    })
    
    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          code: code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Auth] Token exchange via proxy failed:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          proxyUrl: proxyUrl
        })
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`)
      }
      
      const tokens: TokenResponse = await response.json()
      await this.storage.storeTokens(tokens)
      
      // Fetch and store user info
      await this.fetchUserInfo(tokens.access_token)
      
      // Clear pending state
      this.pendingState = null
      this.pendingVerifier = null
      
      console.log('[Auth] Login successful')
    } catch (error) {
      console.error('[Auth] Token exchange failed:', error)
      throw error
    }
  }
  
  private async fetchUserInfo(accessToken: string): Promise<void> {
    const OKTA_DOMAIN = process.env.PLASMO_PUBLIC_OKTA_DOMAIN!
    const USE_DEFAULT_AS = process.env.PLASMO_PUBLIC_OKTA_USE_DEFAULT_AS === 'true'
    const userInfoPath = USE_DEFAULT_AS ? '/oauth2/default/v1/userinfo' : '/oauth2/v1/userinfo'
    
    try {
      const response = await fetch(
        `https://${OKTA_DOMAIN}${userInfoPath}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (!response.ok) {
        throw new Error('Failed to fetch user info')
      }
      
      const userInfo: UserInfo = await response.json()
      await this.storage.storeUserInfo(userInfo)
    } catch (error) {
      console.error('[Auth] Failed to fetch user info:', error)
    }
  }
  
  async logout(): Promise<void> {
    await this.storage.clearTokens()
    console.log('[Auth] Logged out')
  }
  
  async getAccessToken(): Promise<string | null> {
    return await this.storage.getAccessToken()
  }
  
  async isAuthenticated(): Promise<boolean> {
    return await this.storage.isAuthenticated()
  }
  
  async getUserInfo(): Promise<UserInfo | null> {
    return await this.storage.getUserInfo()
  }
}

// Export singleton instance
export const oktaAuth = new OktaAuth()