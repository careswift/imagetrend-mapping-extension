import React from 'react'

interface CompanyErrorProps {
  error: string
  url?: string
  onRetry?: () => void
}

export const CompanyError: React.FC<CompanyErrorProps> = ({ error, url, onRetry }) => {
  const getErrorMessage = () => {
    if (error.includes('No company found')) {
      return {
        title: 'Company Not Configured',
        message: 'This ImageTrend instance is not linked to a company account.',
        action: 'Contact your administrator to configure this URL:',
        details: url ? new URL(url).hostname : 'Current ImageTrend instance'
      }
    }
    
    if (error.includes('network') || error.includes('Network')) {
      return {
        title: 'Connection Error',
        message: 'Unable to connect to the CareSwift API.',
        action: 'Please check your internet connection and try again.',
        showRetry: true
      }
    }
    
    return {
      title: 'Error',
      message: error,
      action: 'Please try again or contact support.'
    }
  }
  
  const errorInfo = getErrorMessage()
  
  return (
    <div style={{
      backgroundColor: '#ffebee',
      border: '1px solid #ffcdd2',
      borderRadius: 6,
      padding: 12,
      marginTop: 12,
      marginBottom: 12
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <svg 
          style={{ width: 18, height: 18, flexShrink: 0, marginTop: 2 }}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="#c62828"
          strokeWidth={2}
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
          />
        </svg>
        <div style={{ flex: 1 }}>
          <h3 style={{ 
            margin: '0 0 6px 0', 
            fontSize: 13, 
            fontWeight: 600, 
            color: '#c62828' 
          }}>
            {errorInfo.title}
          </h3>
          <div style={{ fontSize: 12, color: '#d32f2f' }}>
            <p style={{ margin: '0 0 6px 0' }}>{errorInfo.message}</p>
            {errorInfo.action && (
              <p style={{ margin: '0 0 6px 0' }}>{errorInfo.action}</p>
            )}
            {errorInfo.details && (
              <code style={{
                display: 'block',
                marginTop: 6,
                padding: '4px 6px',
                backgroundColor: '#ffcdd2',
                borderRadius: 3,
                fontSize: 11,
                color: '#b71c1c',
                wordBreak: 'break-all'
              }}>
                {errorInfo.details}
              </code>
            )}
          </div>
          {errorInfo.showRetry && onRetry && (
            <button
              onClick={onRetry}
              style={{
                marginTop: 8,
                padding: '4px 8px',
                backgroundColor: '#c62828',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Try Again →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}