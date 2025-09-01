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
  
  // Clear detection state when URL changes
  if (changeInfo.url) {
    chrome.storage.local.remove([
      `imagetrend_detected_${tabId}`,
      `imagetrend_detected_url_${tabId}`,
      `imagetrend_detected_time_${tabId}`
    ])
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
    console.log('[CareSwift Background] Getting auth state...')
    Promise.all([
      oktaAuth.isAuthenticated(),
      oktaAuth.getUserInfo()
    ]).then(([isAuthenticated, userInfo]) => {
      console.log('[CareSwift Background] Auth state:', { isAuthenticated, userInfo })
      sendResponse({ isAuthenticated, userInfo })
    }).catch(error => {
      console.error('[CareSwift Background] Error getting auth state:', error)
      sendResponse({ isAuthenticated: false, userInfo: null, error: error.message })
    })
    return true
  }
  
  // Helper to get redirect URI for Okta configuration
  if (message.type === 'GET_REDIRECT_URI') {
    const redirectUri = chrome.identity.getRedirectURL()
    console.log('[Background] Redirect URI for Okta:', redirectUri)
    sendResponse({ 
      uri: redirectUri,
      extensionId: chrome.runtime.id,
      instructions: `Add this exact URI to your Okta app's redirect URIs: ${redirectUri}`
    })
    return true
  }
  
  if (message.type === 'GET_CURRENT_TAB') {
    // Return the sender tab info
    sendResponse(sender.tab)
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
  
  // Handle sending pre-extracted data to API
  if (message.type === 'SEND_EXTRACTION') {
    handleFormMapping(message.data, sender.tab)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }))
    return true
  }
  
  // Handle company lookup
  if (message.type === 'LOOKUP_COMPANY') {
    handleCompanyLookup(message.url)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ 
        success: false, 
        error: { 
          message: error.message || 'Failed to lookup company',
          code: error.code 
        }
      }))
    return true
  }
  
  // Handle getting user companies (for admins)
  if (message.type === 'GET_USER_COMPANIES') {
    handleGetUserCompanies()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ 
        success: false, 
        error: error.message 
      }))
    return true
  }
  
  // Handle creating URL mapping
  if (message.type === 'CREATE_URL_MAPPING') {
    handleCreateURLMapping(message.companyId, message.url)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ 
        success: false, 
        error: error.message 
      }))
    return true
  }
})

// Helper function to extract agency code from URL
function extractAgencyCode(url: string): string | null {
  // Pattern: /RunForm/Agency[AGENCY_CODE]/
  const match = url.match(/\/RunForm\/Agency([^\/]+)\//i)
  return match ? match[1] : null
}

// Handle company lookup
async function handleCompanyLookup(url: string) {
  try {
    const result = await apiClient.lookupCompanyByURL(url)
    
    if (!result.success) {
      throw new Error(result.error || 'No company found for this URL')
    }
    
    // Extract agency code and cache the company info
    const agencyCode = extractAgencyCode(url)
    if (agencyCode && result.data) {
      await chrome.storage.local.set({
        [`company_agency_${agencyCode}`]: {
          ...result.data,
          cached_at: Date.now()
        }
      })
    }
    
    return result.data
  } catch (error: any) {
    console.error('[CareSwift Background] Company lookup error:', error)
    throw error
  }
}

// Handle getting user companies (for admins)
async function handleGetUserCompanies() {
  try {
    const accessToken = await oktaAuth.getAccessToken()
    
    if (!accessToken) {
      throw new Error('Authentication required')
    }
    
    const baseUrl = process.env.PLASMO_PUBLIC_API_ENDPOINT
    
    // Call Okta-authenticated admin endpoint
    const response = await fetch(
      `${baseUrl}/api/v1/admin/vendor-forms/companies`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    )
    
    if (!response.ok) {
      throw new Error('Failed to fetch companies')
    }
    
    return await response.json()
  } catch (error: any) {
    console.error('[CareSwift Background] Failed to get companies:', error)
    throw error
  }
}

// Handle creating URL mapping
async function handleCreateURLMapping(companyId: string, url: string) {
  try {
    const accessToken = await oktaAuth.getAccessToken()
    
    if (!accessToken) {
      throw new Error('Authentication required')
    }
    
    const baseUrl = process.env.PLASMO_PUBLIC_API_ENDPOINT
    
    // Call Okta-authenticated admin endpoint
    const response = await fetch(
      `${baseUrl}/api/v1/admin/vendor-forms/url-mapping`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          company_id: companyId,
          url: url
        })
      }
    )
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error || 'Failed to create URL mapping')
    }
    
    // Clear cache for this URL so it reloads
    const agencyCode = extractAgencyCode(url)
    if (agencyCode) {
      await chrome.storage.local.remove(`company_agency_${agencyCode}`)
    }
    
    return await response.json()
  } catch (error: any) {
    console.error('[CareSwift Background] Failed to create URL mapping:', error)
    throw error
  }
}

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
    // Removed storing full extraction to prevent quota exceeded errors
    // The popup gets data from in-memory array via GET_LAST_EXTRACTION message
    // await storage.set('lastExtraction', extraction)  
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

// Clean up storage when tabs are closed
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    // Remove tab-specific data when tab is closed
    chrome.storage.local.remove([
      `imagetrend_detected_${tabId}`,
      `imagetrend_detected_url_${tabId}`,
      `imagetrend_detected_time_${tabId}`
    ]).catch(() => {
      // Ignore errors during cleanup
    })
  })
}

// Comprehensive storage cleanup function
async function cleanupStorageData() {
  try {
    const allData = await chrome.storage.local.get(null)
    const keysToRemove: string[] = []
    const now = Date.now()
    const ONE_HOUR = 60 * 60 * 1000
    
    // Get all active tab IDs
    const tabs = await chrome.tabs.query({})
    const activeTabIds = new Set(tabs.map(tab => tab.id?.toString()))
    
    for (const key in allData) {
      // Remove old tab-specific data
      if (key.startsWith('imagetrend_detected_')) {
        const tabIdMatch = key.match(/imagetrend_detected_(?:time_|url_)?(\d+)/)
        if (tabIdMatch) {
          const tabId = tabIdMatch[1]
          
          // Remove if tab doesn't exist anymore
          if (!activeTabIds.has(tabId)) {
            keysToRemove.push(key)
            continue
          }
          
          // Remove if data is old (check time key)
          if (key.includes('_time_')) {
            const timestamp = new Date(allData[key]).getTime()
            if (now - timestamp > ONE_HOUR) {
              keysToRemove.push(
                `imagetrend_detected_${tabId}`,
                `imagetrend_detected_url_${tabId}`,
                `imagetrend_detected_time_${tabId}`
              )
            }
          }
        }
      }
      
      // Remove old extraction data
      if (key === 'lastExtractionTime') {
        const timestamp = new Date(allData[key]).getTime()
        if (now - timestamp > ONE_HOUR) {
          keysToRemove.push('lastExtractionTime', 'lastExtractionStatus')
        }
      }
    }
    
    // Remove duplicates from keysToRemove
    const uniqueKeys = [...new Set(keysToRemove)]
    
    if (uniqueKeys.length > 0) {
      await chrome.storage.local.remove(uniqueKeys)
      console.log(`[CareSwift Background] Cleaned up ${uniqueKeys.length} storage entries`)
    }
    
    // Check storage usage
    const bytesInUse = await chrome.storage.local.getBytesInUse()
    const quota = chrome.storage.local.QUOTA_BYTES || 10485760 // 10MB default
    const percentUsed = (bytesInUse / quota * 100).toFixed(2)
    console.log(`[CareSwift Background] Storage usage: ${bytesInUse} / ${quota} bytes (${percentUsed}%)`)
    
    // If storage is over 80% full, clear everything except auth tokens
    if (bytesInUse > quota * 0.8) {
      console.warn('[CareSwift Background] Storage usage critical, clearing non-essential data')
      const essentialKeys = ['okta_tokens'] // Keep only auth tokens
      const allKeys = Object.keys(allData)
      const nonEssentialKeys = allKeys.filter(key => !essentialKeys.includes(key))
      await chrome.storage.local.remove(nonEssentialKeys)
    }
  } catch (error) {
    console.error('[CareSwift Background] Error cleaning up storage:', error)
  }
}

// Initialize cleanup when the extension is ready
if (typeof chrome !== 'undefined' && chrome.alarms) {
  // Set up periodic cleanup (every 30 minutes)
  chrome.alarms.create('cleanup-storage', { periodInMinutes: 30 })
  
  // Also set up session cleanup (every 5 minutes to check for expired sessions)
  chrome.alarms.create('cleanup-sessions', { periodInMinutes: 5 })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cleanup-storage') {
      cleanupStorageData()
    }
    if (alarm.name === 'cleanup-sessions') {
      cleanupExpiredSessions()
    }
  })

  // Clean up on startup after a short delay to ensure everything is initialized
  setTimeout(() => {
    cleanupStorageData().catch(error => {
      console.error('[CareSwift Background] Initial cleanup failed:', error)
    })
  }, 1000)
} else {
  console.warn('[CareSwift Background] Chrome alarms API not available')
}

// Clean up expired company sessions
async function cleanupExpiredSessions() {
  try {
    const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes
    const session = await chrome.storage.session.get('active_company_session')
    
    if (session.active_company_session) {
      const age = Date.now() - session.active_company_session.lastActivity
      if (age > SESSION_TIMEOUT) {
        await chrome.storage.session.remove('active_company_session')
        console.log('[CareSwift Background] Expired company session cleared')
      }
    }
  } catch (error) {
    console.error('[CareSwift Background] Session cleanup error:', error)
  }
}