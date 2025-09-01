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