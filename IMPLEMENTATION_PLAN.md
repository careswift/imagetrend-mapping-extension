# ImageTrend Form Mapping Extension Implementation Plan

## Overview

Build a Plasmo-based browser extension for developers/vendors to extract ImageTrend form structure and schema. The extension will run on any website, detect ImageTrend forms, and extract complete mapping data on manual trigger. This is a developer tool for understanding the form structure - no patient data is collected.

## Current State Analysis

- Base Plasmo extension scaffolding exists with React and TypeScript
- No content scripts, background workers, or messaging implemented yet
- Package.json configured with basic Plasmo dependencies
- Host permissions set to `https://*/*` in manifest

## Desired End State

A developer tool extension that:
1. Runs on any website (administrator/developer use only)
2. Detects when ImageTrend forms are present on the page
3. Extracts complete form structure/schema on manual button click
4. Logs the full payload to console for debugging
5. Prepares data for future API integration (API endpoint TBD)
6. NO authentication initially - will be added later
7. NO automatic extraction - only manual trigger by developer

## Architecture Components

### 1. Content Script (ISOLATED world)
- **Location**: `content.tsx`
- **Purpose**: Detects ImageTrend presence, manages bridge, provides developer UI
- **Responsibilities**:
  - Run on ALL websites (matches: `<all_urls>`)
  - Detect if ImageTrend objects exist
  - Inject MAIN world script when ImageTrend detected
  - Set up message bridge
  - Show floating developer button when forms detected

### 2. In-Page Script Bridge (MAIN world)
- **Location**: `contents/imagetrend-bridge.ts`
- **Purpose**: Access window.ko and window.imagetrend objects
- **Responsibilities**:
  - Wait for ImageTrend objects to be ready
  - Extract complete form structure and metadata
  - Deep dive into all form properties for debugging
  - Send data back to content script on manual trigger

### 3. Background Service Worker
- **Location**: `background/index.ts`
- **Purpose**: Message handling and data processing
- **Responsibilities**:
  - Receive extracted data from content script
  - Format and log data for developer inspection
  - Prepare payload structure for future API
  - Store extraction history locally for debugging

### 4. Popup UI
- **Location**: `popup.tsx`
- **Purpose**: Developer control panel
- **Responsibilities**:
  - Show if ImageTrend detected on current tab
  - Manual "Extract Form Mapping" button
  - Display extraction status
  - Show payload size and preview
  - Copy payload to clipboard button

## What We're NOT Doing

- NOT collecting any patient data or form values
- NOT modifying ImageTrend's functionality
- NOT implementing authentication (initially)
- NOT automatically extracting data - manual trigger only
- NOT sending to API yet - just preparing payload structure
- NOT restricting to specific domains - runs everywhere

## Implementation Phases

## Phase 1: Content Script & Page Detection

### Overview
Set up content script to detect ImageTrend on ANY website and provide developer controls.

### Files to Create/Modify:

#### 1. Content Script
**File**: `content.tsx`
```typescript
import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],  // Run on ALL websites
  run_at: "document_idle",
  world: "ISOLATED"
}

let isImageTrendReady = false
let bridgeInjected = false
let extractedData: any = null

// Check for ImageTrend objects periodically
const detectImageTrend = () => {
  // Try to detect ImageTrend by checking for specific elements
  const checkInterval = setInterval(() => {
    // Check if window has ImageTrend (we'll get this from MAIN world)
    if (!bridgeInjected) {
      injectBridge()
    }
  }, 2000)
  
  // Stop checking after 10 seconds
  setTimeout(() => clearInterval(checkInterval), 10000)
}

// Inject MAIN world script
const injectBridge = () => {
  if (bridgeInjected) return
  
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('contents/imagetrend-bridge.js')
  script.onload = () => {
    bridgeInjected = true
    console.log('[CareSwift] Bridge injected, checking for ImageTrend...')
  }
  document.head.appendChild(script)
}

// Listen for messages from MAIN world
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  
  if (event.data.type === 'IMAGETREND_DETECTED') {
    isImageTrendReady = true
    console.log('[CareSwift] ImageTrend detected!')
    showDeveloperButton()
  }
  
  if (event.data.type === 'IMAGETREND_DATA') {
    extractedData = event.data.payload
    console.log('[CareSwift] Form mapping extracted:', extractedData)
    sendToBackground(extractedData)
  }
  
  if (event.data.type === 'IMAGETREND_NOT_FOUND') {
    console.log('[CareSwift] ImageTrend not found on this page')
  }
})

// Send data to background
const sendToBackground = async (data: any) => {
  const response = await chrome.runtime.sendMessage({
    type: 'FORM_MAPPING',
    data
  })
  
  // Log the full payload for developer inspection
  console.group('[CareSwift] Extraction Complete')
  console.log('Payload size:', JSON.stringify(data).length, 'bytes')
  console.log('Full payload:', data)
  console.groupEnd()
  
  updateButton('success')
}

// Developer button UI
const showDeveloperButton = () => {
  // Remove existing button if any
  const existing = document.getElementById('careswift-dev-button')
  if (existing) existing.remove()
  
  const button = document.createElement('button')
  button.id = 'careswift-dev-button'
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 8px;
    z-index: 10000;
    font-family: sans-serif;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    transition: all 0.3s;
  `
  button.textContent = '🔍 Extract ImageTrend Mapping'
  
  button.onmouseover = () => {
    button.style.background = '#1976D2'
    button.style.transform = 'scale(1.05)'
  }
  
  button.onmouseout = () => {
    button.style.background = '#2196F3'
    button.style.transform = 'scale(1)'
  }
  
  button.onclick = () => {
    console.log('[CareSwift] Manual extraction triggered')
    button.textContent = '⏳ Extracting...'
    button.style.background = '#FF9800'
    
    // Request extraction from MAIN world
    window.postMessage({ type: 'EXTRACT_MAPPING' }, '*')
  }
  
  document.body.appendChild(button)
}

const updateButton = (status: 'success' | 'error') => {
  const button = document.getElementById('careswift-dev-button') as HTMLButtonElement
  if (!button) return
  
  if (status === 'success') {
    button.textContent = '✅ Extraction Complete!'
    button.style.background = '#4CAF50'
    
    // Reset button after 3 seconds
    setTimeout(() => {
      button.textContent = '🔍 Extract ImageTrend Mapping'
      button.style.background = '#2196F3'
    }, 3000)
  } else {
    button.textContent = '❌ Extraction Failed'
    button.style.background = '#f44336'
  }
}

// Initialize
console.log('[CareSwift] Extension loaded, detecting ImageTrend...')
detectImageTrend()
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Content script loads on all websites
- [ ] No console errors in development mode

#### Manual Verification:
- [ ] Extension loads on any website
- [ ] Developer button appears when ImageTrend is detected
- [ ] Console shows detection logs
- [ ] Button click triggers extraction request

---

## Phase 2: MAIN World Bridge Implementation

### Overview
Create the bridge script that runs in the page's MAIN world to detect and extract ImageTrend data.

### Files to Create:

#### 1. ImageTrend Bridge Script
**File**: `contents/imagetrend-bridge.ts`
```typescript
import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],  // Run on ALL websites
  world: "MAIN",
  run_at: "document_idle"
}

interface ImageTrendWindow extends Window {
  ko: any
  imagetrend: {
    formComposer: {
      agencyLayouts: any
      formFieldDictionary: any
      agencyResources: any
      formHierarchyCollectionId?: any
      reportingStandardId?: any
    }
    logicEngine: {
      indexedValidationActions: any
      indexedVisibilityActions: any
    }
  }
}

const win = window as ImageTrendWindow

// Check for ImageTrend presence
const checkForImageTrend = () => {
  const checkCount = { current: 0, max: 5 }
  
  const checkInterval = setInterval(() => {
    checkCount.current++
    
    // Check if ImageTrend objects exist
    if (win.imagetrend?.formComposer && win.ko) {
      clearInterval(checkInterval)
      console.log('[CareSwift MAIN] ImageTrend detected!', {
        formComposer: !!win.imagetrend.formComposer,
        ko: !!win.ko,
        url: window.location.href
      })
      window.postMessage({ type: 'IMAGETREND_DETECTED' }, '*')
      setupExtractionListener()
    } else if (checkCount.current >= checkCount.max) {
      clearInterval(checkInterval)
      // Don't spam console on non-ImageTrend sites
      if (window.location.hostname.includes('imagetrend')) {
        console.log('[CareSwift MAIN] ImageTrend not found after checking')
      }
      window.postMessage({ type: 'IMAGETREND_NOT_FOUND' }, '*')
    }
  }, 1000)
}

// Listen for extraction requests
const setupExtractionListener = () => {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data.type === 'EXTRACT_MAPPING') {
      console.log('[CareSwift MAIN] Extraction requested')
      extractFormMapping()
    }
  })
}

// Deep extraction with debugging info
const extractFormMapping = () => {
  try {
    console.group('[CareSwift MAIN] Starting extraction...')
    
    const formComposer = win.imagetrend.formComposer
    const logicEngine = win.imagetrend.logicEngine
    
    // Log what we have access to
    console.log('FormComposer keys:', Object.keys(formComposer || {}))
    console.log('LogicEngine keys:', Object.keys(logicEngine || {}))
    
    // Extract ALL data for debugging
    const formData = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      hostname: window.location.hostname,
      
      // Core IDs
      formHierarchyCollectionId: win.ko?.unwrap(formComposer.formHierarchyCollectionId),
      reportingStandardId: win.ko?.unwrap(formComposer.reportingStandardId),
      
      // Debug: Raw objects (be careful with size)
      debug: {
        formComposerKeys: Object.keys(formComposer || {}),
        logicEngineKeys: Object.keys(logicEngine || {}),
        hasKnockout: !!win.ko,
        sampleLayout: formComposer.agencyLayouts?.[0] ? 
          JSON.stringify(formComposer.agencyLayouts[0]).substring(0, 500) : null
      },
      
      // Extract fields with full details
      fields: extractFields(formComposer.agencyLayouts, formComposer.formFieldDictionary),
      
      // Extract resource groups (enums)
      resourceGroups: extractResourceGroups(formComposer.agencyResources),
      
      // Extract validation rules
      rules: extractRules(logicEngine?.indexedValidationActions, logicEngine?.indexedVisibilityActions),
      
      // Extract repeater metadata
      repeaters: extractRepeaters(formComposer.agencyLayouts),
      
      // Statistics
      stats: {
        fieldCount: 0,
        resourceGroupCount: 0,
        ruleCount: 0,
        repeaterCount: 0
      }
    }
    
    // Update stats
    formData.stats.fieldCount = formData.fields?.length || 0
    formData.stats.resourceGroupCount = formData.resourceGroups?.length || 0
    formData.stats.ruleCount = formData.rules?.length || 0
    formData.stats.repeaterCount = formData.repeaters?.length || 0
    
    console.log('Extraction stats:', formData.stats)
    console.groupEnd()
    
    // Send to content script
    window.postMessage({
      type: 'IMAGETREND_DATA',
      payload: formData
    }, '*')
    
  } catch (error) {
    console.error('[CareSwift MAIN] Extraction error:', error)
    window.postMessage({
      type: 'IMAGETREND_ERROR',
      payload: { 
        error: error.message,
        stack: error.stack
      }
    }, '*')
  }
}

// Extract fields from layouts with deep inspection
const extractFields = (layouts: any, dictionary: any): any[] => {
  const fields = []
  
  if (!layouts) {
    console.log('[CareSwift] No layouts found')
    return fields
  }
  
  // Traverse layouts to find all fields
  const traverse = (node: any, path: string = '', depth: number = 0) => {
    if (!node || depth > 20) return // Prevent infinite recursion
    
    // Log interesting nodes for debugging
    if (depth < 3 && node.Name) {
      console.log(`[CareSwift] Node at depth ${depth}: ${node.Name}`, {
        hasBindingPath: !!node.BindingPathEntryID,
        controlType: node.ControlType,
        hasControls: !!node.Controls,
        hasSections: !!node.Sections
      })
    }
    
    if (node.BindingPathEntryID) {
      const field = {
        id: node.BindingPathEntryID,
        path: path ? `${path}/${node.Name}` : node.Name,
        type: node.ControlType,
        label: win.ko?.unwrap(node.Label),
        required: win.ko?.unwrap(node.Required),
        resourceGroupId: node.ResourceGroupID,
        
        // Extract ALL properties for debugging
        constraints: {
          minLength: node.MinLength,
          maxLength: node.MaxLength,
          min: node.MinValue,
          max: node.MaxValue,
          pattern: node.Pattern,
          mask: node.Mask,
          defaultValue: node.DefaultValue
        },
        
        // Additional metadata
        metadata: {
          isRepeating: node.IsRepeating,
          isCollection: node.IsCollection,
          displayOrder: node.DisplayOrder,
          columnSpan: node.ColumnSpan,
          validation: node.Validation,
          visibility: node.Visibility
        }
      }
      fields.push(field)
    }
    
    // Recurse through children - check all possible child properties
    const childProps = ['Controls', 'Sections', 'Panels', 'Fields', 'Children', 'Items']
    childProps.forEach(prop => {
      if (node[prop]) {
        const children = win.ko?.unwrap(node[prop])
        if (Array.isArray(children)) {
          children.forEach((child: any) => {
            const childPath = path ? `${path}/${node.Name || prop}` : (node.Name || prop)
            traverse(child, childPath, depth + 1)
          })
        }
      }
    })
  }
  
  // Handle different layout structures
  if (Array.isArray(layouts)) {
    console.log(`[CareSwift] Processing ${layouts.length} layouts`)
    layouts.forEach((layout: any, index: number) => {
      console.log(`[CareSwift] Layout ${index}:`, layout.Name || 'Unnamed')
      traverse(layout, '', 0)
    })
  } else if (typeof layouts === 'object') {
    console.log('[CareSwift] Processing single layout object')
    traverse(layouts, '', 0)
  }
  
  console.log(`[CareSwift] Extracted ${fields.length} fields`)
  return fields
}

// Extract resource groups (enums)
const extractResourceGroups = (resources: any): any[] => {
  const groups = []
  
  for (const groupId in resources) {
    const group = resources[groupId]
    groups.push({
      id: groupId,
      name: group.Name,
      elements: group.Elements?.map((elem: any) => ({
        id: elem.ID,
        value: elem.Value,
        text: elem.Text,
        order: elem.Order
      }))
    })
  }
  
  return groups
}

// Extract validation and visibility rules
const extractRules = (validations: any, visibilities: any): any[] => {
  const rules = []
  
  // Process validation rules
  for (const key in validations) {
    const rule = validations[key]
    rules.push({
      type: 'validation',
      id: key,
      targetField: rule.TargetFieldID,
      expression: normalizeExpression(rule.ExpressionGroup)
    })
  }
  
  // Process visibility rules
  for (const key in visibilities) {
    const rule = visibilities[key]
    rules.push({
      type: 'visibility',
      id: key,
      targetField: rule.TargetFieldID,
      expression: normalizeExpression(rule.ExpressionGroup)
    })
  }
  
  return rules
}

// Normalize expression trees
const normalizeExpression = (expr: any): any => {
  if (!expr) return null
  
  return {
    operator: expr.Operator,
    conditions: expr.Conditions?.map((cond: any) => ({
      field: cond.FieldID,
      operator: cond.Operator,
      value: cond.Value
    })),
    groups: expr.Groups?.map((group: any) => normalizeExpression(group))
  }
}

// Extract repeater metadata
const extractRepeaters = (layouts: any): any[] => {
  const repeaters = []
  
  const findRepeaters = (node: any, path: string = '') => {
    if (!node) return
    
    if (node.IsRepeating || node.ControlType === 'Repeater') {
      repeaters.push({
        id: node.ID,
        path: path + '/' + node.Name,
        childBindings: node.Controls?.map((c: any) => c.BindingPathEntryID)
      })
    }
    
    // Recurse
    if (node.Controls) {
      win.ko.unwrap(node.Controls)?.forEach((child: any) => 
        findRepeaters(child, path + '/' + node.Name))
    }
  }
  
  layouts?.forEach((layout: any) => findRepeaters(layout))
  return repeaters
}

// Initialize
checkForImageTrend()
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `npm run build`
- [ ] No type errors in MAIN world script

#### Manual Verification:
- [ ] Script detects ImageTrend when present
- [ ] Extraction logs detailed debugging info to console
- [ ] Complete payload is sent to content script
- [ ] All field types are captured

---

## Phase 3: Background Service Worker (Minimal for Debugging)

### Overview
Implement minimal background service worker to receive and log extracted data.

### Files to Create:

#### 1. Background Service Worker
**File**: `background/index.ts`
```typescript
import { Storage } from "@plasmohq/storage"

const storage = new Storage({ area: "local" })

// Store extraction history
let extractionHistory: any[] = []

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log("[CareSwift Background] Extension installed")
})

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[CareSwift Background] Message received:", message.type)
  
  if (message.type === 'FORM_MAPPING') {
    handleFormMapping(message.data, sender.tab)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }))
    return true // Keep channel open for async response
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
})

// Handle form mapping data
async function handleFormMapping(data: any, tab?: chrome.tabs.Tab) {
  try {
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
    
    console.log("✅ Extraction stored successfully")
    console.log("📋 Ready for API integration - payload structure:")
    console.log({
      fields: `${data.fields?.length || 0} fields`,
      resourceGroups: `${data.resourceGroups?.length || 0} resource groups`,
      rules: `${data.rules?.length || 0} rules`,
      repeaters: `${data.repeaters?.length || 0} repeaters`
    })
    
    console.groupEnd()
    
    // TODO: When API is ready, uncomment this:
    /*
    const response = await fetch('YOUR_API_ENDPOINT', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add auth headers when ready
      },
      body: JSON.stringify(data)
    })
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }
    
    const result = await response.json()
    */
    
    return {
      success: true,
      status: 'Extraction complete - check console for payload',
      dataSize: JSON.stringify(data).length,
      stats: data.stats
    }
    
  } catch (error) {
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
  
  return {
    ready: true,
    lastExtractionTime,
    extractionCount: extractionHistory.length,
    apiConfigured: false // Will be true when API is ready
  }
}

// Export function to get extraction history (for popup)
export function getExtractionHistory() {
  return extractionHistory
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Background worker compiles: `npm run build`
- [ ] Message handlers work correctly

#### Manual Verification:
- [ ] Extraction data is logged to console
- [ ] Data is stored in extension storage
- [ ] Payload structure is visible for API planning

---

## Phase 4: Update Popup UI (Developer Control Panel)

### Overview
Update the popup to be a developer control panel for extraction and debugging.

### Files to Modify:

#### 1. Popup Component
**File**: `popup.tsx`
```typescript
import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"

function IndexPopup() {
  const [status, setStatus] = useState<any>({})
  const [lastExtraction, setLastExtraction] = useState<any>(null)
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null)
  const [lastExtractionTime] = useStorage("lastExtractionTime")
  
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
  
  return (
    <div style={{ padding: 16, width: 400, fontFamily: 'monospace' }}>
      <h2 style={{ marginTop: 0, color: '#2196F3' }}>🔍 ImageTrend Mapper Dev Tools</h2>
      
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
          🚀 Extract on Current Page
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
          <li>Check console for detailed payload</li>
          <li>API endpoint: Not configured (payload only)</li>
        </ul>
      </div>
    </div>
  )
}

export default IndexPopup
```

### Success Criteria:

#### Automated Verification:
- [ ] Popup compiles without errors: `npm run build`
- [ ] No TypeScript errors

#### Manual Verification:
- [ ] Popup shows current tab URL
- [ ] Extraction stats are displayed
- [ ] Copy to clipboard works
- [ ] DevTools console button opens extension page

---

## Phase 5: Type Definitions & Polish

### Overview
Add TypeScript definitions and prepare for API integration.

### Files to Create:

#### 1. Type Definitions
**File**: `types/imagetrend.ts`
```typescript
export interface FormMapping {
  fingerprint: string
  formHierarchyCollectionId: string
  reportingStandardId: string
  fields: FormField[]
  resourceGroups: ResourceGroup[]
  rules: Rule[]
  repeaters: Repeater[]
}

export interface FormField {
  id: string
  path: string
  type: string
  label: string
  required: boolean
  resourceGroupId?: string
  constraints: FieldConstraints
}

export interface FieldConstraints {
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  pattern?: string
}

export interface ResourceGroup {
  id: string
  name: string
  elements: ResourceElement[]
}

export interface ResourceElement {
  id: string
  value: string
  text: string
  order: number
}

export interface Rule {
  type: 'validation' | 'visibility'
  id: string
  targetField: string
  expression: Expression
}

export interface Expression {
  operator: string
  conditions?: Condition[]
  groups?: Expression[]
}

export interface Condition {
  field: string
  operator: string
  value: any
}

export interface Repeater {
  id: string
  path: string
  childBindings: string[]
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Full build succeeds: `npm run build`
- [ ] TypeScript strict mode passes
- [ ] No linting errors: `npm run lint` (if configured)

#### Manual Verification:
- [ ] Extension loads in Chrome developer mode
- [ ] All features work end-to-end
- [ ] Error states are handled gracefully

---

## Testing Strategy

### Manual Testing Steps:
1. **Setup:**
   - Run `npm run dev` to build and watch for changes
   - Load extension in Chrome: chrome://extensions/ → Developer mode → Load unpacked
   - Select the `build/chrome-mv3-dev` directory

2. **Testing ImageTrend Detection:**
   - Navigate to any ImageTrend website
   - Open DevTools Console (F12)
   - Look for "[CareSwift]" logs indicating detection
   - Verify the blue extraction button appears

3. **Testing Extraction:**
   - Click the "🔍 Extract ImageTrend Mapping" button
   - Check console for extraction logs
   - Verify payload structure in console
   - Check that stats are logged (field count, etc.)

4. **Testing Popup:**
   - Click extension icon in toolbar
   - Verify current tab URL is shown
   - Check extraction stats if available
   - Test "Copy Payload" button
   - Verify console button opens extensions page

5. **Debugging Tips:**
   - Check both page console AND extension console
   - Extension console: chrome://extensions/ → Details → Inspect views
   - Look for errors in both ISOLATED and MAIN world scripts

## Next Steps & API Integration

When ready to connect to API:

1. **Define API Endpoint:**
   ```typescript
   // In background/index.ts, replace the TODO section with:
   const API_ENDPOINT = 'https://your-api.com/imagetrend/mapping'
   
   const response = await fetch(API_ENDPOINT, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       // Add auth headers when ready
     },
     body: JSON.stringify(data)
   })
   ```

2. **Expected Payload Structure:**
   The extension will send:
   ```json
   {
     "timestamp": "ISO date",
     "url": "current page URL",
     "hostname": "domain",
     "formHierarchyCollectionId": "ID",
     "reportingStandardId": "ID",
     "fields": [...],
     "resourceGroups": [...],
     "rules": [...],
     "repeaters": [...],
     "stats": {
       "fieldCount": 0,
       "resourceGroupCount": 0,
       "ruleCount": 0,
       "repeaterCount": 0
     }
   }
   ```

3. **Authentication (when needed):**
   - Add options page for API key/token configuration
   - Store securely using Plasmo Storage API
   - Include in request headers

## Deployment Notes

1. **Development:** `npm run dev`
2. **Production Build:** `npm run build`
3. **Package for distribution:** `npm run package`
4. **Test on real ImageTrend instances before deployment**

## References

- [Plasmo Documentation](https://docs.plasmo.com)
- [Chrome Extension APIs](https://developer.chrome.com/docs/extensions/reference/)
- [Plasmo Messaging Examples](https://github.com/PlasmoHQ/examples/tree/main/with-messaging)
- [Plasmo Storage Examples](https://github.com/PlasmoHQ/examples/tree/main/with-storage)