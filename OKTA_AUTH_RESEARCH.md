# Research: Okta Authentication for ImageTrend Mapping Browser Extension

**Date**: 2025-08-29 19:03:24 PDT  
**Researcher**: Claude  
**Git Commit**: bb788c00858c81df3f83e28b5279c609f3eef836  
**Branch**: master  
**Repository**: imagetrend-mapping  

## Executive Summary

Based on comprehensive research, implementing Okta authentication in your Plasmo-based browser extension is **feasible and well-supported**. The recommended approach is to:

1. **Configure Okta as an SPA (Single Page Application)** with Authorization Code + PKCE flow
2. **Use Chrome Identity API** (`chrome.identity.launchWebAuthFlow()`) for the OAuth flow
3. **Store tokens securely** using `chrome.storage.session` or encrypted storage
4. **Implement token refresh** with rotation for enhanced security

## Recommended Implementation Architecture

### 1. Okta Application Configuration

Create an **SPA (Single Page Application)** in Okta with these settings:

```json
{
  "applicationType": "browser",
  "grantTypes": ["authorization_code"],
  "responseTypes": ["code"],
  "tokenEndpointAuthMethod": "none",
  "redirectUris": [
    "https://<extension-id>.chromiumapp.org/",
    "https://your-domain.com/oauth/callback"  // Fallback for redirect handling
  ]
}
```

**Why SPA?**
- Browser extensions are **public clients** that cannot securely store secrets
- SPAs are designed for environments where source code is visible
- Supports Authorization Code + PKCE without requiring a client secret

### 2. Authentication Flow Implementation

```typescript
// background/auth.ts
import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "session" })  // Use session storage for tokens

export async function initiateOktaLogin() {
  const CLIENT_ID = process.env.PLASMO_PUBLIC_OKTA_CLIENT_ID
  const OKTA_DOMAIN = process.env.PLASMO_PUBLIC_OKTA_DOMAIN
  
  // Generate PKCE parameters
  const codeVerifier = generateRandomString(128)
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  
  // Store code verifier for later use
  await storage.set('pkce_verifier', codeVerifier)
  
  // Build authorization URL
  const authUrl = new URL(`https://${OKTA_DOMAIN}/oauth2/default/v1/authorize`)
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', chrome.identity.getRedirectURL())
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', generateRandomString(32))
  
  // Launch OAuth flow
  chrome.identity.launchWebAuthFlow({
    url: authUrl.href,
    interactive: true
  }, async (redirectUrl) => {
    if (chrome.runtime.lastError || !redirectUrl) {
      console.error('Auth failed:', chrome.runtime.lastError)
      return
    }
    
    // Extract authorization code
    const url = new URL(redirectUrl)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    
    // Exchange code for tokens
    await exchangeCodeForTokens(code, codeVerifier)
  })
}

async function exchangeCodeForTokens(code: string, codeVerifier: string) {
  const response = await fetch(`https://${OKTA_DOMAIN}/oauth2/default/v1/token`, {
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
  })
  
  const tokens = await response.json()
  
  // Store tokens securely
  await storage.set('access_token', tokens.access_token)
  await storage.set('id_token', tokens.id_token)
  await storage.set('refresh_token', tokens.refresh_token)
  await storage.set('token_expiry', Date.now() + (tokens.expires_in * 1000))
}
```

### 3. Token Storage Strategy

**Recommended Approach**: Use `chrome.storage.session` with encryption

```typescript
// utils/secure-storage.ts
export class SecureTokenStorage {
  private storage = new Storage({ area: "session" })
  
  async storeTokens(tokens: TokenResponse) {
    // Session storage is memory-only, cleared on browser restart
    await this.storage.set('access_token', tokens.access_token)
    await this.storage.set('refresh_token', tokens.refresh_token)
    await this.storage.set('token_expiry', Date.now() + (tokens.expires_in * 1000))
  }
  
  async getAccessToken(): Promise<string | null> {
    const token = await this.storage.get('access_token')
    const expiry = await this.storage.get('token_expiry')
    
    // Check if token is expired
    if (expiry && Date.now() > expiry) {
      return await this.refreshAccessToken()
    }
    
    return token
  }
  
  async refreshAccessToken(): Promise<string | null> {
    const refreshToken = await this.storage.get('refresh_token')
    if (!refreshToken) return null
    
    // Implement token refresh with rotation
    const response = await fetch(`https://${OKTA_DOMAIN}/oauth2/default/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID
      })
    })
    
    const tokens = await response.json()
    await this.storeTokens(tokens)
    return tokens.access_token
  }
}
```

### 4. API Request with Bearer Token

```typescript
// background/api.ts
export async function sendToAPI(data: any) {
  const tokenStorage = new SecureTokenStorage()
  const accessToken = await tokenStorage.getAccessToken()
  
  if (!accessToken) {
    // Trigger re-authentication
    await initiateOktaLogin()
    return
  }
  
  const response = await fetch('https://your-api.com/imagetrend/mapping', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(data)
  })
  
  if (response.status === 401) {
    // Token expired or invalid, refresh and retry
    await tokenStorage.refreshAccessToken()
    // Retry request
  }
  
  return response.json()
}
```

### 5. Popup UI Integration

```typescript
// popup.tsx
import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"

function IndexPopup() {
  const [isAuthenticated] = useStorage("access_token")
  const [user] = useStorage("user_info")
  
  const handleLogin = () => {
    chrome.runtime.sendMessage({ type: 'LOGIN' })
  }
  
  const handleLogout = () => {
    chrome.runtime.sendMessage({ type: 'LOGOUT' })
  }
  
  if (!isAuthenticated) {
    return (
      <div style={{ padding: 16, width: 400 }}>
        <h2>ImageTrend Mapper</h2>
        <p>Please sign in to continue</p>
        <button onClick={handleLogin} style={{
          padding: '10px 20px',
          backgroundColor: '#007dc1',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer'
        }}>
          Sign in with Okta
        </button>
      </div>
    )
  }
  
  return (
    <div style={{ padding: 16, width: 400 }}>
      <h2>ImageTrend Mapper</h2>
      <p>Signed in as: {user?.email}</p>
      {/* Existing extraction UI */}
      <button onClick={handleLogout}>Sign Out</button>
    </div>
  )
}
```

## Key Technical Decisions

### Why Chrome Identity API?
- **Built-in security**: Handles OAuth flow in isolated context
- **Automatic redirect handling**: Manages `chrome-extension://` URI challenges
- **No popup blocking**: Avoids browser popup blocker issues
- **Simplified implementation**: Reduces OAuth complexity

### Why PKCE?
- **Security**: Prevents authorization code interception attacks
- **No client secret needed**: Perfect for public clients like browser extensions
- **Industry standard**: Required by OAuth 2.1 and recommended by Okta
- **Protection against malicious extensions**: Prevents token theft by other extensions

### Why Session Storage?
- **Memory-only storage**: Tokens never written to disk
- **Automatic cleanup**: Cleared on browser restart
- **Isolated access**: Only accessible to your extension
- **Balance of security and UX**: More secure than localStorage, better UX than constant re-auth

## Implementation Roadmap

### Phase 1: Basic Authentication (Week 1)
1. Create Okta SPA application
2. Implement Chrome Identity API flow
3. Add login/logout to popup UI
4. Test authorization code exchange

### Phase 2: Token Management (Week 2)
1. Implement secure token storage
2. Add token refresh logic
3. Handle token expiration
4. Implement automatic retry on 401

### Phase 3: Integration (Week 3)
1. Update API calls to include bearer token
2. Add user info display
3. Implement error handling
4. Add authentication state persistence

### Phase 4: Polish & Security (Week 4)
1. Implement PKCE properly
2. Add token rotation
3. Security audit
4. User experience improvements

## Security Considerations

### Critical Security Requirements
1. **Never store tokens in localStorage or chrome.storage.local**
2. **Always use HTTPS for token exchange**
3. **Implement token rotation for refresh tokens**
4. **Validate state parameter to prevent CSRF**
5. **Use short-lived access tokens (1 hour or less)**

### Potential Vulnerabilities
- **XSS attacks**: Any XSS in extension can compromise tokens
- **Malicious extensions**: Other extensions could attempt to steal tokens
- **Token leakage**: Tokens in URLs or logs could be exposed
- **Redirect manipulation**: Ensure redirect URIs are properly validated

## Alternative Approaches

### 1. Backend for Frontend (BFF) Pattern
If maximum security is required, consider:
- Proxy authentication through your backend
- Store tokens server-side
- Extension only receives session cookies
- More complex but most secure

### 2. Popup Window Approach
For cross-browser compatibility:
- Open popup window for OAuth
- Use postMessage for communication
- Works without Chrome Identity API
- Required for Firefox/Safari support

## Testing Strategy

### Authentication Flow Testing
1. Test successful login flow
2. Test login cancellation
3. Test invalid credentials
4. Test network failures

### Token Management Testing
1. Test token expiration handling
2. Test refresh token rotation
3. Test concurrent refresh attempts
4. Test storage persistence

### Security Testing
1. Verify tokens not visible in extension storage viewer
2. Test XSS prevention
3. Verify HTTPS enforcement
4. Test CSRF protection

## Troubleshooting Guide

### Common Issues

**Issue**: "Invalid redirect URI" error from Okta
- **Solution**: Add `https://<extension-id>.chromiumapp.org/` to Okta app

**Issue**: Token expires during long sessions
- **Solution**: Implement proactive token refresh before expiry

**Issue**: User sees multiple login prompts
- **Solution**: Check token caching and refresh logic

**Issue**: 401 errors after successful login
- **Solution**: Verify token is included in Authorization header

## Resources and References

### Official Documentation
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Okta OAuth 2.0 Guide](https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/)
- [Plasmo Storage API](https://docs.plasmo.com/framework/storage)

### Example Implementations
- [Chrome Extension OAuth Example](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.oauth2)
- [Plasmo with Firebase Auth](https://github.com/PlasmoHQ/examples/tree/main/with-firebase-auth)
- [PKCE Implementation](https://github.com/oktadev/okta-auth-js-pkce-example)

### Security Resources
- [OAuth 2.0 Security Best Practices](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
- [OWASP Browser Extension Security](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html)

## Conclusion

Implementing Okta authentication in your browser extension is definitely feasible. The combination of:
- Okta SPA configuration
- Chrome Identity API
- PKCE flow
- Secure token storage

...provides a robust and secure authentication solution. The main challenges will be handling token lifecycle management and ensuring cross-browser compatibility if needed in the future.

The implementation is straightforward enough that it should take 2-4 weeks to fully implement and test, depending on your specific requirements and existing familiarity with OAuth flows.