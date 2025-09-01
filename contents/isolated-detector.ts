import type { PlasmoCSConfig } from "plasmo"

// Required for non-React content scripts
export {}

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],  // Run on ALL websites
  run_at: "document_idle"
}

let isImageTrendReady = false
let extractedData: any = null

// Store detection state for current tab
const updateDetectionState = async (detected: boolean) => {
  isImageTrendReady = detected
  // Store in Chrome storage with tab-specific key
  const tab = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' })
  if (tab?.id) {
    // Clean up old tab data first to prevent storage overflow
    await cleanupOldTabData()
    
    await chrome.storage.local.set({ 
      [`imagetrend_detected_${tab.id}`]: detected,
      [`imagetrend_detected_url_${tab.id}`]: window.location.href,
      [`imagetrend_detected_time_${tab.id}`]: new Date().toISOString()
    })
  }
}

// Clean up storage data from closed tabs or old entries
const cleanupOldTabData = async () => {
  try {
    const allData = await chrome.storage.local.get(null)
    const keysToRemove: string[] = []
    const now = Date.now()
    const ONE_HOUR = 60 * 60 * 1000
    
    for (const key in allData) {
      // Check if it's a tab-related key
      if (key.startsWith('imagetrend_detected_')) {
        // Extract tab ID from key
        const match = key.match(/imagetrend_detected_time_(\d+)/)
        if (match) {
          const timestamp = new Date(allData[key]).getTime()
          // Remove data older than 1 hour
          if (now - timestamp > ONE_HOUR) {
            const tabId = match[1]
            keysToRemove.push(
              `imagetrend_detected_${tabId}`,
              `imagetrend_detected_url_${tabId}`,
              `imagetrend_detected_time_${tabId}`
            )
          }
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove)
      console.log(`[CareSwift] Cleaned up ${keysToRemove.length} old storage entries`)
    }
  } catch (error) {
    console.error('[CareSwift] Error cleaning up storage:', error)
  }
}

// Listen for messages from MAIN world
window.addEventListener('message', async (event) => {
  if (event.source !== window) return
  
  if (event.data.type === 'IMAGETREND_DETECTED') {
    await updateDetectionState(true)
    console.log('[CareSwift] ImageTrend detected and state saved!')
  }
  
  if (event.data.type === 'IMAGETREND_DATA') {
    extractedData = event.data.payload
    console.log('[CareSwift] Form mapping extracted:', extractedData)
    // Data is now stored, will be sent only when explicitly requested via the "Send to API" button
  }
  
  if (event.data.type === 'IMAGETREND_NOT_FOUND') {
    await updateDetectionState(false)
    console.log('[CareSwift] ImageTrend not found on this page')
  }
})

// Note: Data is no longer automatically sent to the background/API on extraction.
// The extraction flow is now:
// 1. User clicks "Extract Data" - data is extracted and stored locally
// 2. User reviews the extracted data  
// 3. User clicks "Send to API" - popup sends the data to background/API via SEND_EXTRACTION message


// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_IMAGETREND') {
    // Check both in-memory flag and storage
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB' }).then(async (tab) => {
      if (tab?.id) {
        const storageKey = `imagetrend_detected_${tab.id}`
        const stored = await chrome.storage.local.get(storageKey)
        const detected = stored[storageKey] || isImageTrendReady
        console.log('[CareSwift] ImageTrend status check:', detected, '(memory:', isImageTrendReady, 'storage:', stored[storageKey], ')')
        sendResponse({ detected })
      } else {
        sendResponse({ detected: isImageTrendReady })
      }
    })
    return true
  }
  
  if (message.type === 'RETRY_DETECTION') {
    console.log('[CareSwift] Retrying ImageTrend detection')
    // Re-inject the main world script to retry detection
    chrome.runtime.sendMessage({ type: 'INJECT_MAIN_SCRIPT' })
    sendResponse({ success: true })
    return true
  }
  
  if (message.type === 'EXTRACT_ONLY') {
    if (!isImageTrendReady) {
      sendResponse({ success: false, error: 'ImageTrend not detected on this page' })
      return true
    }
    
    console.log('[CareSwift] Extract only requested from popup')
    // Request extraction from MAIN world
    window.postMessage({ type: 'EXTRACT_MAPPING' }, '*')
    
    // Wait for extraction to complete
    const handleExtractionResponse = (event: MessageEvent) => {
      if (event.data.type === 'IMAGETREND_DATA') {
        window.removeEventListener('message', handleExtractionResponse)
        sendResponse({ success: true, data: event.data.payload })
      }
    }
    
    window.addEventListener('message', handleExtractionResponse)
    return true // Keep message channel open for async response
  }
  
  if (message.type === 'TRIGGER_EXTRACTION') {
    console.log('[CareSwift] Full extraction and send requested from popup')
    window.postMessage({ type: 'EXTRACT_MAPPING' }, '*')
    sendResponse({ success: true })
    return true
  }
})

// Initialize
console.log('[CareSwift] Content script (ISOLATED) loaded, waiting for ImageTrend detection from MAIN world...')