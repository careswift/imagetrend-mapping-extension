# Okta Authentication & API Integration Implementation Plan

## Overview

Implement Okta OAuth authentication with PKCE flow and integrate API calls to send ImageTrend mapping data to the CareSwift backend. The extension will authenticate users via Okta, store tokens securely, and include bearer tokens in all API requests.

## Current State Analysis

The extension currently:
- Successfully extracts ImageTrend form mapping data (467 fields, 633 resource groups, 281 rules)
- Has API call structure commented out at `background/index.ts:122-138`
- Uses Plasmo framework with React popup UI
- Has comprehensive Okta research documented in `OKTA_AUTH_RESEARCH.md`
- Lacks authentication implementation and active API integration

## Desired End State

A fully authenticated extension that:
- Requires Okta login before allowing data extraction
- Securely stores OAuth tokens in session storage
- Sends extracted data to configurable API endpoints with bearer tokens
- Handles token refresh automatically
- Shows user authentication status in popup UI

### Key Discoveries:
- Chrome Identity API is available for OAuth flows (`chrome.identity.launchWebAuthFlow()`)
- Plasmo Storage supports both local and session storage areas
- PKCE flow is required for browser extension security
- API endpoint placeholder exists at `background/index.ts:122-138`

## What We're NOT Doing

- NOT implementing cross-browser support (Chrome only for now)
- NOT storing tokens in localStorage or chrome.storage.local (security risk)
- NOT implementing Backend-for-Frontend pattern (using direct OAuth)
- NOT adding user management features beyond basic auth
- NOT implementing offline mode or request queuing

## Implementation Approach

Use Chrome Identity API with Okta SPA configuration, implementing Authorization Code + PKCE flow. Store tokens in session storage for security, and integrate API calls with bearer token authentication.

---

## Phase 1: Environment & Configuration Setup

### Overview
Set up Okta application, configure environment variables, and update extension permissions for authentication.

### Changes Required:

#### 1. Create Environment Configuration
**File**: `.env.local` (new file)
```bash
# API Configuration
PLASMO_PUBLIC_API_ENDPOINT=http://localhost:8000
PLASMO_PUBLIC_API_MAPPING_PATH=/api/v1/imagetrend/mapping
PLASMO_PUBLIC_API_AUTH_PATH=/api/v1/auth/validate

# Okta Configuration  
PLASMO_PUBLIC_OKTA_CLIENT_ID=0oa1xrp4oj0OnKicQ1d8
PLASMO_PUBLIC_OKTA_DOMAIN=careswift.okta.com
PLASMO_PUBLIC_OKTA_ISSUER=https://careswift.okta.com
```

#### 2. Update Package.json Permissions
**File**: `package.json`
**Changes**: Add identity permission for OAuth
```json
{
  "manifest": {
    "permissions": [
      "scripting",
      "storage",
      "identity"
    ],
    "host_permissions": [
      "<all_urls>"
    ]
  }
}
```

#### 3. Add Required Dependencies
**File**: `package.json`
**Changes**: Add crypto utilities for PKCE
```bash
npm install --save crypto-js @types/crypto-js
```

#### 4. Create TypeScript Types
**File**: `types/auth.ts` (new file)
```typescript
export interface TokenResponse {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope?: string
}

export interface UserInfo {
  sub: string
  email: string
  name?: string
  preferred_username?: string
}

export interface AuthState {
  isAuthenticated: boolean
  user?: UserInfo
  accessToken?: string
  expiresAt?: number
}

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
```

### Success Criteria:

#### Automated Verification:
- [x] Environment variables load correctly: `npm run dev`
- [x] TypeScript compiles without errors: `npm run build`
- [x] Extension loads with new permissions: Check chrome://extensions

#### Manual Verification:
- [ ] Okta SPA application created with correct redirect URIs
- [ ] Environment variables accessible in code
- [ ] No permission errors in extension console

---

## Phase 2: Core Authentication Module

### Overview
Implement the OAuth flow with PKCE, token storage, and refresh logic.

### Changes Required:

#### 1. PKCE Utilities
**File**: `utils/pkce.ts` (new file)
```typescript
import CryptoJS from 'crypto-js'

export function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
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
```

#### 2. Secure Token Storage
**File**: `utils/secure-storage.ts` (new file)
```typescript
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
    const token = await this.storage.get('access_token')
    const expiry = await this.storage.get('token_expiry')
    
    if (!token) return null
    
    // Check if token is expired (with 5 minute buffer)
    if (expiry && Date.now() > (expiry - 300000)) {
      return await this.refreshAccessToken()
    }
    
    return token
  }
  
  async refreshAccessToken(): Promise<string | null> {
    const refreshToken = await this.storage.get('refresh_token')
    if (!refreshToken) return null
    
    try {
      const response = await fetch(
        `https://${process.env.PLASMO_PUBLIC_OKTA_DOMAIN}/oauth2/default/v1/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: process.env.PLASMO_PUBLIC_OKTA_CLIENT_ID!,
            scope: 'openid profile email offline_access'
          })
        }
      )
      
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
    const token = await this.getAccessToken()
    return token !== null
  }
}
```

#### 3. OAuth Authentication Module
**File**: `background/auth.ts` (new file)
```typescript
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
    
    // Generate PKCE parameters
    const codeVerifier = generateRandomString(128)
    const codeChallenge = await generateCodeChallenge(codeVerifier)
    const state = generateState()
    
    // Store for later use
    this.pendingVerifier = codeVerifier
    this.pendingState = state
    
    // Build authorization URL
    const authUrl = new URL(`https://${OKTA_DOMAIN}/oauth2/v1/authorize`)
    authUrl.searchParams.set('client_id', CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', chrome.identity.getRedirectURL())
    authUrl.searchParams.set('scope', 'openid profile email offline_access')
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)
    
    // Launch OAuth flow
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl.href,
        interactive: true
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError || !redirectUrl) {
          console.error('[Auth] Login failed:', chrome.runtime.lastError)
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
    const CLIENT_ID = process.env.PLASMO_PUBLIC_OKTA_CLIENT_ID!
    const OKTA_DOMAIN = process.env.PLASMO_PUBLIC_OKTA_DOMAIN!
    
    try {
      const response = await fetch(
        `https://${OKTA_DOMAIN}/oauth2/v1/token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: chrome.identity.getRedirectURL(),
            client_id: CLIENT_ID,
            code_verifier: codeVerifier
          })
        }
      )
      
      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`)
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
    
    try {
      const response = await fetch(
        `https://${OKTA_DOMAIN}/oauth2/v1/userinfo`,
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
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `npm run build`
- [x] No circular dependency warnings
- [x] All imports resolve correctly

#### Manual Verification:
- [ ] OAuth flow launches when triggered
- [ ] Tokens are stored in session storage (check via extension DevTools)
- [ ] Token refresh works when token expires
- [ ] User info is fetched after login

---

## Phase 3: Background Worker Integration

### Overview
Integrate authentication into the background worker and implement authenticated API calls.

### Changes Required:

#### 1. API Client Module
**File**: `background/api-client.ts` (new file)
```typescript
import { oktaAuth } from "./auth"
import type { ApiResponse } from "~types/auth"

export class ApiClient {
  private baseUrl = process.env.PLASMO_PUBLIC_API_ENDPOINT!
  
  private async makeRequest<T = any>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const accessToken = await oktaAuth.getAccessToken()
    
    if (!accessToken) {
      throw new Error('Not authenticated')
    }
    
    const url = `${this.baseUrl}${path}`
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          ...options.headers
        }
      })
      
      // Handle 401 - try to refresh token
      if (response.status === 401) {
        console.log('[API] Token expired, refreshing...')
        const newToken = await oktaAuth.getAccessToken() // Will trigger refresh
        if (newToken) {
          // Retry with new token
          const retryResponse = await fetch(url, {
            ...options,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${newToken}`,
              ...options.headers
            }
          })
          
          if (!retryResponse.ok) {
            throw new Error(`API request failed: ${retryResponse.status}`)
          }
          
          return await retryResponse.json()
        } else {
          // Refresh failed, need to re-login
          throw new Error('Authentication expired')
        }
      }
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`)
      }
      
      const data = await response.json()
      return {
        success: true,
        data
      }
    } catch (error: any) {
      console.error('[API] Request failed:', error)
      return {
        success: false,
        error: error.message
      }
    }
  }
  
  async sendFormMapping(data: any): Promise<ApiResponse> {
    const path = process.env.PLASMO_PUBLIC_API_MAPPING_PATH || '/api/v1/imagetrend/mapping'
    return await this.makeRequest(path, {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }
  
  async validateAuth(): Promise<ApiResponse<{ valid: boolean; user?: any }>> {
    const path = process.env.PLASMO_PUBLIC_API_AUTH_PATH || '/api/v1/auth/validate'
    return await this.makeRequest(path, {
      method: 'GET'
    })
  }
}

export const apiClient = new ApiClient()
```

#### 2. Update Background Worker
**File**: `background/index.ts`
**Changes**: Add authentication and API integration
```typescript
import { Storage } from "@plasmohq/storage"
import { oktaAuth } from "./auth"
import { apiClient } from "./api-client"
import imagetrendExtractor from "./imagetrend-extractor"

const storage = new Storage({ area: "local" })

// Store extraction history
let extractionHistory: any[] = []

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log("[CareSwift Background] Extension installed")
  
  // Inject script into all existing tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        injectMainWorldScript(tab.id)
      }
    })
  })
})

// Auto-inject on tab update
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    injectMainWorldScript(tabId)
  }
})

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[CareSwift Background] Message received:", message.type)
  
  // Handle authentication messages
  if (message.type === 'LOGIN') {
    oktaAuth.initiateLogin()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }))
    return true
  }
  
  if (message.type === 'LOGOUT') {
    oktaAuth.logout()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }))
    return true
  }
  
  if (message.type === 'GET_AUTH_STATE') {
    Promise.all([
      oktaAuth.isAuthenticated(),
      oktaAuth.getUserInfo()
    ]).then(([isAuthenticated, userInfo]) => {
      sendResponse({ isAuthenticated, userInfo })
    })
    return true
  }
  
  // Existing message handlers
  if (message.type === 'FORM_MAPPING') {
    handleFormMapping(message.data, sender.tab)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }))
    return true
  }
  
  if (message.type === 'GET_STATUS') {
    getStatus().then(sendResponse)
    return true
  }
  
  if (message.type === 'GET_LAST_EXTRACTION') {
    const lastExtraction = extractionHistory[extractionHistory.length - 1]
    sendResponse(lastExtraction || null)
    return true
  }
  
  if (message.type === 'INJECT_MAIN_SCRIPT') {
    injectMainWorldScript(sender.tab?.id)
    sendResponse({ success: true })
    return true
  }
})

// Handle form mapping data with API integration
async function handleFormMapping(data: any, tab?: chrome.tabs.Tab) {
  try {
    // Check authentication first
    const isAuthenticated = await oktaAuth.isAuthenticated()
    if (!isAuthenticated) {
      console.error('[CareSwift Background] Not authenticated')
      return {
        success: false,
        status: 'Authentication required',
        error: 'Please sign in to send data'
      }
    }
    
    console.group("[CareSwift Background] Form Mapping Received")
    console.log("From URL:", tab?.url)
    console.log("Timestamp:", data.timestamp)
    console.log("Stats:", data.stats)
    console.log("Full payload size:", JSON.stringify(data).length, "bytes")
    
    // Store in history
    const extraction = {
      ...data,
      tabId: tab?.id,
      tabUrl: tab?.url,
      extractionTime: new Date().toISOString()
    }
    
    extractionHistory.push(extraction)
    
    // Keep only last 10 extractions in memory
    if (extractionHistory.length > 10) {
      extractionHistory.shift()
    }
    
    // Store last extraction in storage
    await storage.set('lastExtraction', extraction)
    await storage.set('lastExtractionTime', extraction.extractionTime)
    
    // Send to API
    console.log("[CareSwift Background] Sending to API...")
    const apiResponse = await apiClient.sendFormMapping(data)
    
    if (apiResponse.success) {
      console.log("✅ Data sent to API successfully")
      console.log("API Response:", apiResponse.data)
    } else {
      console.error("❌ API request failed:", apiResponse.error)
    }
    
    console.groupEnd()
    
    return {
      success: apiResponse.success,
      status: apiResponse.success ? 'Data sent successfully' : 'API request failed',
      dataSize: JSON.stringify(data).length,
      stats: data.stats,
      apiResponse: apiResponse.data,
      error: apiResponse.error
    }
    
  } catch (error: any) {
    console.error('[CareSwift Background] Error:', error)
    return {
      success: false,
      status: 'Error',
      error: error.message
    }
  }
}

// Get extension status
async function getStatus() {
  const lastExtractionTime = await storage.get('lastExtractionTime')
  const isAuthenticated = await oktaAuth.isAuthenticated()
  const userInfo = await oktaAuth.getUserInfo()
  
  return {
    ready: true,
    lastExtractionTime,
    extractionCount: extractionHistory.length,
    apiConfigured: !!process.env.PLASMO_PUBLIC_API_ENDPOINT,
    isAuthenticated,
    userEmail: userInfo?.email
  }
}

// Inject main world script
function injectMainWorldScript(tabId?: number) {
  if (!tabId) return
  
  chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: imagetrendExtractor
  }).catch(err => {
    // Silently fail for chrome:// pages
    if (!err.message?.includes('Cannot access')) {
      console.error('[CareSwift Background] Script injection failed:', err)
    }
  })
}
```

### Success Criteria:

#### Automated Verification:
- [x] Background worker compiles: `npm run build`
- [x] No TypeScript errors in API client
- [x] Message handlers return proper responses

#### Manual Verification:
- [ ] API calls include bearer token in headers
- [ ] 401 responses trigger token refresh
- [ ] Extraction fails when not authenticated
- [ ] API responses are logged correctly

---

## Phase 4: Popup UI Authentication

### Overview
Update the popup UI to show authentication state and provide login/logout functionality.

### Changes Required:

#### 1. Authentication Hook
**File**: `hooks/useAuth.ts` (new file)
```typescript
import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import type { UserInfo } from "~types/auth"

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Use storage hooks for reactive updates
  const [accessToken] = useStorage("access_token")
  const [storedUserInfo] = useStorage<UserInfo>("user_info")
  
  useEffect(() => {
    checkAuthState()
  }, [accessToken])
  
  useEffect(() => {
    if (storedUserInfo) {
      setUserInfo(storedUserInfo)
    }
  }, [storedUserInfo])
  
  const checkAuthState = async () => {
    setLoading(true)
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (response) => {
      if (response) {
        setIsAuthenticated(response.isAuthenticated)
        setUserInfo(response.userInfo)
      }
      setLoading(false)
    })
  }
  
  const login = () => {
    chrome.runtime.sendMessage({ type: 'LOGIN' }, (response) => {
      if (response?.success) {
        // State will update automatically via storage hooks
        console.log('Login initiated')
      }
    })
  }
  
  const logout = () => {
    chrome.runtime.sendMessage({ type: 'LOGOUT' }, (response) => {
      if (response?.success) {
        setIsAuthenticated(false)
        setUserInfo(null)
      }
    })
  }
  
  return {
    isAuthenticated,
    userInfo,
    loading,
    login,
    logout
  }
}
```

#### 2. Updated Popup Component
**File**: `popup.tsx`
**Changes**: Add authentication UI
```typescript
import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { useAuth } from "~hooks/useAuth"

function IndexPopup() {
  const [status, setStatus] = useState<any>({})
  const [lastExtraction, setLastExtraction] = useState<any>(null)
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null)
  const [lastExtractionTime] = useStorage("lastExtractionTime")
  
  const { isAuthenticated, userInfo, loading, login, logout } = useAuth()
  
  useEffect(() => {
    // Get current tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setCurrentTab(tabs[0])
    })
    
    // Get initial status
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
      setStatus(response)
    })
    
    // Get last extraction
    chrome.runtime.sendMessage({ type: 'GET_LAST_EXTRACTION' }, (extraction) => {
      setLastExtraction(extraction)
    })
  }, [])
  
  const handleExtract = () => {
    if (!isAuthenticated) {
      alert('Please sign in first to extract and send data')
      return
    }
    
    // Send message to content script to trigger extraction
    if (currentTab?.id) {
      chrome.tabs.sendMessage(currentTab.id, { type: 'TRIGGER_EXTRACTION' }, (response) => {
        console.log('Extraction triggered:', response)
        // Refresh status after extraction
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'GET_LAST_EXTRACTION' }, setLastExtraction)
          chrome.runtime.sendMessage({ type: 'GET_STATUS' }, setStatus)
        }, 1000)
      })
    }
  }
  
  const copyToClipboard = () => {
    if (lastExtraction) {
      navigator.clipboard.writeText(JSON.stringify(lastExtraction, null, 2))
      alert('Payload copied to clipboard!')
    }
  }
  
  const openConsole = () => {
    chrome.tabs.create({ url: 'chrome://extensions/' })
  }
  
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    return date.toLocaleString()
  }
  
  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B'
    const sizes = ['B', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
  }
  
  if (loading) {
    return (
      <div style={{ padding: 16, width: 400, fontFamily: 'monospace' }}>
        <h2 style={{ marginTop: 0, color: '#2196F3' }}>🔍 ImageTrend Mapper</h2>
        <p>Loading...</p>
      </div>
    )
  }
  
  if (!isAuthenticated) {
    return (
      <div style={{ padding: 16, width: 400, fontFamily: 'monospace' }}>
        <h2 style={{ marginTop: 0, color: '#2196F3' }}>🔍 ImageTrend Mapper</h2>
        
        <div style={{
          padding: 20,
          backgroundColor: '#f5f5f5',
          borderRadius: 8,
          textAlign: 'center',
          marginTop: 20
        }}>
          <h3 style={{ marginTop: 0 }}>Authentication Required</h3>
          <p style={{ color: '#666', marginBottom: 20 }}>
            Please sign in with your Okta account to extract and send ImageTrend data
          </p>
          
          <button 
            onClick={login}
            style={{
              padding: '12px 24px',
              backgroundColor: '#007dc1',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 14
            }}
          >
            Sign in with Okta
          </button>
          
          <div style={{
            marginTop: 20,
            padding: 10,
            backgroundColor: '#fff3cd',
            borderRadius: 4,
            fontSize: 11,
            textAlign: 'left'
          }}>
            <strong>Note:</strong> You'll be redirected to your organization's Okta login page
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div style={{ padding: 16, width: 400, fontFamily: 'monospace' }}>
      <h2 style={{ marginTop: 0, color: '#2196F3' }}>🔍 ImageTrend Mapper Dev Tools</h2>
      
      {/* User Info Section */}
      <div style={{
        marginBottom: 16,
        padding: 12,
        backgroundColor: '#e3f2fd',
        borderRadius: 4,
        fontSize: 12
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Signed in as:</strong><br/>
            {userInfo?.email || 'Unknown'}
          </div>
          <button
            onClick={logout}
            style={{
              padding: '6px 12px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
      
      <div style={{ 
        marginBottom: 16, 
        padding: 12, 
        backgroundColor: '#f5f5f5', 
        borderRadius: 4,
        fontSize: 12
      }}>
        <div><strong>Current Tab:</strong></div>
        <div style={{ 
          whiteSpace: 'nowrap', 
          overflow: 'hidden', 
          textOverflow: 'ellipsis' 
        }}>
          {currentTab?.url || 'Unknown'}
        </div>
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <strong>Status:</strong> {status.ready ? '✅ Ready' : '⏳ Loading...'}
        {status.apiConfigured && (
          <span style={{ marginLeft: 10, color: '#4CAF50' }}>
            | API Connected
          </span>
        )}
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <strong>Last Extraction:</strong> {formatDate(lastExtractionTime)}
      </div>
      
      {lastExtraction && (
        <div style={{ 
          marginBottom: 16, 
          padding: 12, 
          backgroundColor: '#e8f5e9', 
          borderRadius: 4 
        }}>
          <div><strong>📊 Last Payload Stats:</strong></div>
          <div>Fields: {lastExtraction.stats?.fieldCount || 0}</div>
          <div>Resource Groups: {lastExtraction.stats?.resourceGroupCount || 0}</div>
          <div>Rules: {lastExtraction.stats?.ruleCount || 0}</div>
          <div>Size: {formatBytes(JSON.stringify(lastExtraction).length)}</div>
          {lastExtraction.apiResponse && (
            <div style={{ marginTop: 8, color: '#4CAF50' }}>
              ✅ Sent to API successfully
            </div>
          )}
        </div>
      )}
      
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button 
          onClick={handleExtract}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          🚀 Extract & Send
        </button>
        
        <button 
          onClick={copyToClipboard}
          disabled={!lastExtraction}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: lastExtraction ? '#4CAF50' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: lastExtraction ? 'pointer' : 'not-allowed',
            fontWeight: 'bold'
          }}
        >
          📋 Copy Payload
        </button>
      </div>
      
      <button 
        onClick={openConsole}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#FF9800',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 'bold'
        }}
      >
        🛠️ Open DevTools Console
      </button>
      
      <div style={{ 
        marginTop: 16, 
        padding: 12, 
        backgroundColor: '#fff3cd', 
        borderRadius: 4,
        fontSize: 11
      }}>
        <strong>💡 Developer Notes:</strong>
        <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
          <li>Extension runs on ALL websites</li>
          <li>Button appears when ImageTrend detected</li>
          <li>Data is sent to: {process.env.PLASMO_PUBLIC_API_ENDPOINT || 'Not configured'}</li>
          <li>Authentication: Okta OAuth2 with PKCE</li>
        </ul>
      </div>
    </div>
  )
}

export default IndexPopup
```

### Success Criteria:

#### Automated Verification:
- [x] Popup compiles without errors: `npm run build`
- [x] TypeScript types are correct
- [x] React hooks work properly

#### Manual Verification:
- [ ] Login button triggers OAuth flow
- [ ] User info displays after login
- [ ] Logout clears authentication state
- [ ] Extract button is disabled when not authenticated
- [ ] UI updates reactively when auth state changes

---

## Phase 5: Error Handling & Testing

### Overview
Implement comprehensive error handling, retry logic, and test all authentication flows.

### Changes Required:

#### 1. Error Handling Utilities
**File**: `utils/error-handler.ts` (new file)
```typescript
export enum ErrorType {
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  EXTRACTION_ERROR = 'EXTRACTION_ERROR'
}

export class AppError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public details?: any
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function handleError(error: any): AppError {
  if (error instanceof AppError) {
    return error
  }
  
  if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
    return new AppError(ErrorType.TOKEN_EXPIRED, 'Authentication expired', error)
  }
  
  if (error.message?.includes('network') || error.message?.includes('fetch')) {
    return new AppError(ErrorType.NETWORK_ERROR, 'Network error occurred', error)
  }
  
  return new AppError(ErrorType.API_ERROR, error.message || 'Unknown error', error)
}

export function showUserError(error: AppError): void {
  // In production, could integrate with a toast notification system
  console.error(`[${error.type}] ${error.message}`, error.details)
  
  // User-friendly messages
  const userMessages: Record<ErrorType, string> = {
    [ErrorType.AUTH_FAILED]: 'Login failed. Please try again.',
    [ErrorType.TOKEN_EXPIRED]: 'Your session has expired. Please login again.',
    [ErrorType.API_ERROR]: 'Failed to send data. Please try again later.',
    [ErrorType.NETWORK_ERROR]: 'Network error. Please check your connection.',
    [ErrorType.EXTRACTION_ERROR]: 'Failed to extract data from the page.'
  }
  
  const message = userMessages[error.type] || error.message
  
  // Send to popup for display
  chrome.runtime.sendMessage({
    type: 'SHOW_ERROR',
    error: {
      type: error.type,
      message
    }
  })
}
```

#### 2. Retry Logic
**File**: `utils/retry.ts` (new file)
```typescript
interface RetryOptions {
  maxAttempts?: number
  delay?: number
  backoff?: boolean
  onRetry?: (attempt: number, error: any) => void
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delay = 1000,
    backoff = true,
    onRetry
  } = options
  
  let lastError: any
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      
      if (attempt < maxAttempts) {
        const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay
        
        if (onRetry) {
          onRetry(attempt, error)
        }
        
        console.log(`[Retry] Attempt ${attempt} failed, retrying in ${waitTime}ms...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
  }
  
  throw lastError
}
```

#### 3. Test Configuration
**File**: `test-config.md` (new file)
```markdown
# Testing Configuration

## Test Okta Application Settings

For testing, create a test Okta application with these settings:

1. Application Type: Single Page Application (SPA)
2. Grant Type: Authorization Code
3. Redirect URIs:
   - `https://<your-extension-id>.chromiumapp.org/`
   - `http://localhost:1947/` (for development)

4. Sign-in redirect URIs: Same as above
5. Sign-out redirect URIs: Same as above
6. Trusted Origins: Add your extension ID

## Test Environment Variables

Create `.env.test`:
```bash
PLASMO_PUBLIC_API_ENDPOINT=http://localhost:8000
PLASMO_PUBLIC_API_MAPPING_PATH=/api/v1/imagetrend/mapping
PLASMO_PUBLIC_API_AUTH_PATH=/api/v1/auth/validate

PLASMO_PUBLIC_OKTA_CLIENT_ID=0oa1xrp4oj0OnKicQ1d8
PLASMO_PUBLIC_OKTA_DOMAIN=careswift.okta.com
PLASMO_PUBLIC_OKTA_ISSUER=https://careswift.okta.com
```

## Manual Testing Checklist

### Authentication Flow
- [ ] Click "Sign in with Okta" opens OAuth window
- [ ] Successful login stores tokens in session storage
- [ ] User info displays correctly in popup
- [ ] Logout clears all tokens and user info
- [ ] Token persists across popup close/open (during session)
- [ ] Token clears on browser restart (session storage)

### Token Management
- [ ] Access token includes in API requests
- [ ] Expired token triggers refresh automatically
- [ ] Failed refresh redirects to login
- [ ] Multiple concurrent API calls handle token refresh correctly

### API Integration
- [ ] Extraction sends data to configured endpoint
- [ ] Bearer token included in Authorization header
- [ ] 401 response triggers token refresh
- [ ] Network errors show appropriate messages
- [ ] Success response updates UI

### Error Handling
- [ ] Invalid credentials show error message
- [ ] Network timeout shows error
- [ ] API errors display to user
- [ ] Extraction continues to work offline (stores locally)

### Edge Cases
- [ ] Extension works on chrome:// pages (no extraction)
- [ ] Multiple tabs handle authentication state correctly
- [ ] Popup reopening maintains auth state
- [ ] Background worker restart maintains functionality
```

### Success Criteria:

#### Automated Verification:
- [x] All TypeScript compiles: `npm run build`
- [x] No circular dependencies
- [x] Error types are properly exported

#### Manual Verification:
- [ ] OAuth flow completes successfully
- [ ] Tokens refresh automatically
- [ ] API calls include authentication
- [ ] Error messages display to user
- [ ] Retry logic works for transient failures

---

## Testing Strategy

### Unit Tests:
- Test PKCE parameter generation
- Test token storage and retrieval
- Test token expiry checking
- Test API request retry logic

### Integration Tests:
- Test full OAuth flow with test Okta app
- Test API calls with mock endpoints
- Test token refresh flow
- Test error handling scenarios

### Manual Testing Steps:
1. Load extension in Chrome developer mode
2. Click extension icon to open popup
3. Click "Sign in with Okta" and complete login
4. Navigate to a page with ImageTrend forms
5. Click floating extraction button
6. Verify data is sent to API with auth token
7. Check console for API response
8. Test logout and re-login flow
9. Test token expiry by waiting for timeout
10. Test network error handling by going offline

## Performance Considerations

- Token refresh happens proactively 5 minutes before expiry
- Session storage used for security (memory only)
- API calls include retry logic with exponential backoff
- Background worker handles auth state centrally

## Migration Notes

For existing users without authentication:
1. Extension will prompt for login on first use after update
2. Previously extracted data remains in local storage
3. New extractions require authentication
4. No data migration needed

## References

- Original research: `OKTA_AUTH_RESEARCH.md`
- Chrome Identity API: https://developer.chrome.com/docs/extensions/reference/api/identity
- Okta OAuth Guide: https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/
- Plasmo Storage: https://docs.plasmo.com/framework/storage