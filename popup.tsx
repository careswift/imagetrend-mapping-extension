import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { useAuth } from "~hooks/useAuth"
import { apiClient } from "~background/api-client"
import { CompanyError } from "~components/CompanyError"
import { CompanySelector } from "~components/CompanySelector"
import { CompanySessionManager } from "~background/session"
import "./style.css"

interface CompanyInfo {
  company_id: string
  company_name: string
  last_extraction?: string
  extraction_count?: number
}

function IndexPopup() {
  console.log('[Popup] Rendering IndexPopup component')
  
  const [status, setStatus] = useState<any>({})
  const [lastExtraction, setLastExtraction] = useState<any>(null)
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null)
  const [lastExtractionTime] = useStorage("lastExtractionTime")
  const [pendingExtraction, setPendingExtraction] = useState<any>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isImageTrendDetected, setIsImageTrendDetected] = useState<boolean | null>(null)
  const [isCheckingDetection, setIsCheckingDetection] = useState(true)
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)
  const [companyLoading, setCompanyLoading] = useState(false)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const [showCompanySelector, setShowCompanySelector] = useState(false)
  
  const { isAuthenticated, userInfo, loading, login, logout } = useAuth()
  
  console.log('[Popup] Auth state:', { isAuthenticated, userInfo, loading })
  
  // Initialize session manager
  const sessionManager = new CompanySessionManager()
  
  // Load company info when authenticated and on ImageTrend page
  useEffect(() => {
    const loadCompanyInfo = async () => {
      if (!isAuthenticated || !currentTab?.url?.includes('imagetrend')) {
        return
      }
      
      setCompanyLoading(true)
      setCompanyError(null)
      
      try {
        // Check for existing session first
        const session = await sessionManager.getActiveSession()
        if (session && await sessionManager.isCurrentAgency(currentTab.url)) {
          // Use cached session data for same agency
          setCompanyInfo({
            company_id: session.companyId,
            company_name: session.companyName
          })
          setCompanyLoading(false)
          
          // Update activity in background
          sessionManager.updateActivity()
          return
        }
        
        // No valid session, lookup company
        chrome.runtime.sendMessage({
          type: 'LOOKUP_COMPANY',
          url: currentTab.url
        }, async (response) => {
          if (response?.success && response?.data) {
            setCompanyInfo(response.data)
            // Establish new session
            await sessionManager.setActiveSession(
              response.data.company_id,
              response.data.company_name,
              currentTab.url
            )
          } else if (response?.error) {
            setCompanyError(response.error.message || response.error || 'No company found for this URL')
          }
          setCompanyLoading(false)
        })
      } catch (error) {
        console.error('Failed to load company info:', error)
        setCompanyError('Failed to load company information')
        setCompanyLoading(false)
      }
    }
    
    loadCompanyInfo()
  }, [isAuthenticated, currentTab?.url])
  
  useEffect(() => {
    // Get current tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      setCurrentTab(tabs[0])
      
      // Check if ImageTrend is detected on current tab
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CHECK_IMAGETREND' }, (response) => {
          if (chrome.runtime.lastError) {
            // Content script not loaded or tab not ready
            setIsImageTrendDetected(false)
          } else {
            setIsImageTrendDetected(response?.detected || false)
          }
          setIsCheckingDetection(false)
        })
      }
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
      alert('Please sign in first to extract data')
      return
    }
    
    // Check if company is configured first
    if (!companyInfo) {
      alert('Cannot extract data: No company configured for this ImageTrend instance')
      return
    }
    
    setIsExtracting(true)
    // Send message to content script to trigger extraction only (not send)
    if (currentTab?.id) {
      chrome.tabs.sendMessage(currentTab.id, { type: 'EXTRACT_ONLY' }, (response) => {
        console.log('Extraction completed:', response)
        setIsExtracting(false)
        if (response && response.data) {
          // Calculate statistics
          const stats = {
            fieldCount: response.data.fields?.length || 0,
            resourceGroupCount: response.data.resourceGroups?.length || 0,
            ruleCount: response.data.rules?.length || 0,
            totalSize: JSON.stringify(response.data).length
          }
          // Include company context in the pending extraction
          setPendingExtraction({ 
            ...response.data, 
            stats,
            companyId: companyInfo.company_id,
            companyName: companyInfo.company_name
          })
        }
      })
    }
  }
  
  const handleSend = () => {
    if (!pendingExtraction) return
    
    // Show confirmation dialog
    const confirmed = confirm(
      `Are you sure you want to send this data to the API?\n\n` +
      `Fields: ${pendingExtraction.stats.fieldCount}\n` +
      `Resource Groups: ${pendingExtraction.stats.resourceGroupCount}\n` +
      `Rules: ${pendingExtraction.stats.ruleCount}\n` +
      `Size: ${formatBytes(pendingExtraction.stats.totalSize)}\n\n` +
      `This action cannot be undone.`
    )
    
    if (!confirmed) return
    
    setIsSending(true)
    // Send the pending extraction data to the API
    chrome.runtime.sendMessage(
      { type: 'SEND_EXTRACTION', data: pendingExtraction },
      (response) => {
        setIsSending(false)
        if (response.success) {
          setLastExtraction({ ...pendingExtraction, apiResponse: response })
          setPendingExtraction(null)
          alert('Data sent successfully!')
        } else {
          alert(`Failed to send data: ${response.error || 'Unknown error'}`)
        }
      }
    )
  }
  
  const copyToClipboard = () => {
    const dataToCopy = pendingExtraction || lastExtraction
    if (dataToCopy) {
      navigator.clipboard.writeText(JSON.stringify(dataToCopy, null, 2))
      alert('Payload copied to clipboard!')
    }
  }
  
  const handleRetryDetection = () => {
    setIsCheckingDetection(true)
    if (currentTab?.id) {
      // First inject the main script again
      chrome.runtime.sendMessage({ type: 'INJECT_MAIN_SCRIPT' }, () => {
        // Then check detection status after a short delay
        setTimeout(() => {
          chrome.tabs.sendMessage(currentTab.id!, { type: 'CHECK_IMAGETREND' }, (response) => {
            if (chrome.runtime.lastError) {
              setIsImageTrendDetected(false)
            } else {
              setIsImageTrendDetected(response?.detected || false)
            }
            setIsCheckingDetection(false)
          })
        }, 1000)
      })
    }
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
      <div style={{ padding: 16, width: 400, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <h2 style={{ marginTop: 0, color: '#2196F3' }}>🔍 ImageTrend Mapper</h2>
        <p>Loading...</p>
      </div>
    )
  }
  
  if (!isAuthenticated) {
    return (
      <div style={{ 
        padding: 40, 
        width: 300, 
        backgroundColor: 'white',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <h2 style={{
          color: 'rgb(75, 76, 207)',
          marginTop: 0,
          marginBottom: 30,
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: 20,
          fontWeight: 'normal'
        }}>
          CareSwift Mapper 1.0
        </h2>
        <button 
          onClick={login}
          style={{
            padding: '14px 32px',
            backgroundColor: 'rgb(75, 76, 207)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: 16,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}
        >
          Sign in with Okta
        </button>
      </div>
    )
  }
  
  // Show CompanySelector as a full replacement view when active
  if (showCompanySelector && currentTab?.url) {
    return (
      <div style={{ 
        width: 400,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' 
      }}>
        <CompanySelector
          currentUrl={currentTab.url}
          onCompanySelected={async (company) => {
            setCompanyInfo({
              company_id: company.company_id,
              company_name: company.company_name
            })
            setCompanyError(null)
            setShowCompanySelector(false)
            
            // Establish session for the new company
            await sessionManager.setActiveSession(
              company.company_id,
              company.company_name,
              currentTab.url
            )
            
            // Reload company info to get full details
            chrome.runtime.sendMessage({
              type: 'LOOKUP_COMPANY',
              url: currentTab?.url
            }, (response) => {
              if (response?.success && response?.data) {
                setCompanyInfo(response.data)
              }
            })
          }}
          onCancel={() => setShowCompanySelector(false)}
        />
      </div>
    )
  }

  return (
    <div style={{ 
      padding: 16, 
      width: 400,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' 
    }}>
      <h2 style={{ marginTop: 0, color: 'rgb(75, 76, 207)' }}>ImageTrend Mapper Dev Tools</h2>
      
      {/* User Info Section */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <strong>Signed in as:</strong> {userInfo?.email || 'Unknown'}
        </div>
        <button
          onClick={logout}
          style={{
            padding: '6px 12px',
            backgroundColor: '#dc3545',
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
      
      {/* Only show company info if company is configured */}
      {companyInfo && (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong>Company:</strong>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#333' }}>
                  {companyInfo.company_name}
                </div>
                {companyInfo.last_extraction && (
                  <div style={{ fontSize: 11, color: '#666' }}>
                    Last: {new Date(companyInfo.last_extraction).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
            
            {/* Only show change button if user is admin */}
            {userInfo?.email && (
              <button
                onClick={() => setShowCompanySelector(true)}
                style={{
                  fontSize: 11,
                  color: 'rgb(75, 76, 207)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  padding: '2px 0',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  marginTop: 4
                }}
              >
                Change Company
              </button>
            )}
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <strong>Last Extraction:</strong> {formatDate(lastExtractionTime)}
          </div>
        </>
      )}
      
      {/* Show loading state */}
      {companyLoading && (
        <div style={{ marginBottom: 16, textAlign: 'center' }}>
          <div style={{
            width: 20,
            height: 20,
            border: '2px solid #e0e0e0',
            borderTopColor: 'rgb(75, 76, 207)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto'
          }} />
          <span style={{ fontSize: 12, color: '#666', marginTop: 8 }}>Loading company info...</span>
        </div>
      )}
      
      {/* ImageTrend Detection Status - simplified */}
      {isCheckingDetection ? (
        <div style={{ 
          marginBottom: 16, 
          padding: 12, 
          backgroundColor: '#f5f5f5', 
          borderRadius: 4,
          textAlign: 'center'
        }}>
          Checking for ImageTrend...
        </div>
      ) : !isImageTrendDetected ? (
        <div style={{ 
          marginBottom: 16, 
          padding: 12, 
          backgroundColor: '#ffebee', 
          borderRadius: 4,
          border: '1px solid #ef5350'
        }}>
          <div style={{ marginBottom: 8, color: '#c62828' }}>
            <strong>ImageTrend not detected on this page</strong>
          </div>
          <div style={{ fontSize: 12, marginBottom: 10, color: '#666' }}>
            This extension only works on ImageTrend report pages. Please navigate to an ImageTrend report to use the extraction features.
          </div>
          <button
            onClick={handleRetryDetection}
            style={{
              padding: '6px 12px',
              backgroundColor: 'rgb(75, 76, 207)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Retry Detection
          </button>
        </div>
      ) : companyInfo ? (
        <div style={{ 
          marginBottom: 16, 
          padding: 8, 
          backgroundColor: '#e8f5e9', 
          borderRadius: 4,
          fontSize: 12,
          color: '#2e7d32'
        }}>
          ImageTrend detected - Ready to extract
        </div>
      ) : !companyLoading && (
        // When ImageTrend is detected but no company configured
        <div style={{ 
          marginBottom: 16, 
          padding: 12, 
          backgroundColor: '#f5f5f5', 
          borderRadius: 4,
          textAlign: 'center'
        }}>
          <div style={{ marginBottom: 8, color: '#333', fontWeight: 600 }}>
            No Company Configured
          </div>
          <div style={{ fontSize: 12, color: '#666' }}>
            Please select a company for this ImageTrend URL
          </div>
        </div>
      )}
      
      {/* Show extracted data summary with actions */}
      {pendingExtraction ? (
        <div style={{ 
          marginBottom: 16, 
          padding: 12, 
          backgroundColor: '#f8f9fa', 
          borderRadius: 4,
          border: '1px solid #e0e0e0'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong>Extracted Data Summary:</strong>
            <button
              onClick={copyToClipboard}
              title="Copy payload to clipboard"
              style={{
                padding: '4px 8px',
                backgroundColor: 'transparent',
                border: '1px solid rgb(75, 76, 207)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                color: 'rgb(75, 76, 207)'
              }}
            >
              Copy
            </button>
          </div>
          <div>Fields: {pendingExtraction.stats?.fieldCount || 0}</div>
          <div>Resource Groups: {pendingExtraction.stats?.resourceGroupCount || 0}</div>
          <div>Rules: {pendingExtraction.stats?.ruleCount || 0}</div>
          <div>Size: {formatBytes(pendingExtraction.stats?.totalSize || 0)}</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
            <button
              onClick={handleSend}
              disabled={isSending}
              style={{
                flex: 1,
                padding: '8px 16px',
                backgroundColor: 'rgb(75, 76, 207)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: isSending ? 'not-allowed' : 'pointer',
                fontWeight: 'bold'
              }}
            >
              {isSending ? 'Sending...' : 'Send to API'}
            </button>
            <button
              onClick={() => setPendingExtraction(null)}
              style={{
                flex: 1,
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: 'rgb(75, 76, 207)',
                border: '2px solid rgb(75, 76, 207)',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Back
            </button>
          </div>
        </div>
      ) : lastExtraction ? (
        <div style={{ 
          marginBottom: 16, 
          padding: 12, 
          backgroundColor: '#e8f5e9', 
          borderRadius: 4,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 16, color: '#2e7d32', marginBottom: 10 }}>
            Sent to API
          </div>
          <button
            onClick={() => setLastExtraction(null)}
            style={{
              padding: '8px 24px',
              backgroundColor: 'transparent',
              color: 'rgb(75, 76, 207)',
              border: '2px solid rgb(75, 76, 207)',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Back
          </button>
        </div>
      ) : null}
      
      {/* Progressive display: Only show relevant actions based on state */}
      {isImageTrendDetected && !companyInfo && !companyLoading && (
        <div style={{ marginBottom: 12 }}>
          <button 
            onClick={() => setShowCompanySelector(true)}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: 'rgb(75, 76, 207)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Select Company for This URL
          </button>
        </div>
      )}
      
      {/* Only show extract button if ImageTrend is detected AND company is configured */}
      {isImageTrendDetected && companyInfo && !pendingExtraction && !lastExtraction && (
        <div style={{ marginBottom: 12 }}>
          <button 
            onClick={handleExtract}
            disabled={isExtracting}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: isExtracting ? '#ccc' : 'rgb(75, 76, 207)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: isExtracting ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {isExtracting ? 'Extracting...' : 'Extract Data'}
          </button>
        </div>
      )}
    </div>
  )
}

export default IndexPopup