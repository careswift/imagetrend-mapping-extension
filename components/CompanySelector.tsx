import React, { useState, useEffect } from 'react'

interface Company {
  company_id: string
  company_name: string
  configured_agency?: string
}

interface CompanySelectorProps {
  currentUrl: string
  onCompanySelected: (company: Company) => void
  onCancel: () => void
}

export const CompanySelector: React.FC<CompanySelectorProps> = ({
  currentUrl,
  onCompanySelected,
  onCancel
}) => {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isMapping, setIsMapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    loadUserCompanies()
  }, [])
  
  const loadUserCompanies = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_USER_COMPANIES'
      })
      
      if (response.success && response.data?.companies) {
        setCompanies(response.data.companies)
      } else {
        setError('Failed to load companies')
      }
    } catch (error) {
      console.error('Failed to load companies:', error)
      setError('Failed to load available companies')
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleConfirm = async () => {
    if (!selectedCompanyId) {
      setError('Please select a company')
      return
    }
    
    const selectedCompany = companies.find(c => c.company_id === selectedCompanyId)
    if (!selectedCompany) {
      return
    }
    
    setIsMapping(true)
    setError(null)
    
    try {
      // Create URL mapping for this company
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_URL_MAPPING',
        companyId: selectedCompanyId,
        url: currentUrl
      })
      
      if (response.success) {
        // Success - notify parent
        onCompanySelected(selectedCompany)
      } else {
        setError(response.error || 'Failed to create mapping')
      }
    } catch (error) {
      console.error('Failed to create URL mapping:', error)
      setError('Failed to map URL to company')
    } finally {
      setIsMapping(false)
    }
  }
  
  if (isLoading) {
    return (
      <div style={{
        backgroundColor: 'white',
        padding: 16,
        textAlign: 'center'
      }}>
        <div style={{
          width: 32,
          height: 32,
          border: '3px solid #e0e0e0',
          borderTopColor: 'rgb(75, 76, 207)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '40px auto 12px'
        }} />
        <div style={{ fontSize: 14, color: '#666', marginBottom: 40 }}>Loading companies...</div>
      </div>
    )
  }
  
  return (
    <div style={{
      backgroundColor: 'white',
      padding: 16
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: 16,
        gap: 12
      }}>
        <button
            onClick={onCancel}
            style={{
              padding: '4px 8px',
              backgroundColor: 'transparent',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: 20,
              lineHeight: 1
            }}
          >
            ←
          </button>
          <h2 style={{ 
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: '#333'
          }}>
            Select Company
          </h2>
        </div>
        
        <div style={{ marginBottom: 16 }}>
          <p style={{ 
            fontSize: 13,
            color: '#666',
            margin: '0 0 8px 0'
          }}>
            This ImageTrend instance hasn't been linked to a company yet. 
            Please select which company this form belongs to:
          </p>
          <div style={{
            backgroundColor: '#f5f5f5',
            borderRadius: 4,
            padding: 8
          }}>
            <span style={{ fontSize: 11, color: '#999' }}>URL:</span>
            <div style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#333',
              wordBreak: 'break-all'
            }}>
              {currentUrl}
            </div>
          </div>
        </div>
        
        {companies.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '24px 0'
          }}>
            <p style={{ color: '#666', margin: 0 }}>No companies available</p>
            <p style={{ 
              fontSize: 12,
              color: '#999',
              marginTop: 8
            }}>
              Please contact your administrator
            </p>
          </div>
        ) : (
          <div style={{ 
            marginBottom: 16
          }}>
            {companies.map(company => (
              <label
                key={company.company_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: 10,
                  marginBottom: 8,
                  border: '1px solid',
                  borderColor: selectedCompanyId === company.company_id ? 'rgb(75, 76, 207)' : '#e0e0e0',
                  borderRadius: 4,
                  cursor: 'pointer',
                  backgroundColor: selectedCompanyId === company.company_id ? '#f8f9ff' : 'white',
                  transition: 'all 0.2s'
                }}
              >
                <input
                  type="radio"
                  name="company"
                  value={company.company_id}
                  checked={selectedCompanyId === company.company_id}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                  style={{ marginRight: 10 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontWeight: 500,
                    fontSize: 14,
                    color: '#333'
                  }}>
                    {company.company_name}
                  </div>
                  {company.configured_agency && (
                    <span style={{
                      fontSize: 11,
                      color: '#999',
                      marginLeft: 0
                    }}>
                      (Agency: {company.configured_agency})
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
        
        {error && (
          <div style={{
            marginBottom: 16,
            padding: 10,
            backgroundColor: '#ffebee',
            border: '1px solid #ffcdd2',
            borderRadius: 4,
            fontSize: 13,
            color: '#c62828'
          }}>
            {error}
          </div>
        )}
        
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          borderTop: '1px solid #e0e0e0',
          paddingTop: 12
        }}>
          <button
            onClick={onCancel}
            disabled={isMapping}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              color: '#666',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              fontSize: 14,
              cursor: isMapping ? 'not-allowed' : 'pointer',
              opacity: isMapping ? 0.5 : 1
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedCompanyId || isMapping || companies.length === 0}
            style={{
              padding: '8px 16px',
              backgroundColor: 'rgb(75, 76, 207)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              fontSize: 14,
              fontWeight: 500,
              cursor: (!selectedCompanyId || isMapping || companies.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (!selectedCompanyId || isMapping || companies.length === 0) ? 0.5 : 1
            }}
          >
            {isMapping ? 'Creating Mapping...' : 'Confirm Selection'}
          </button>
        </div>
    </div>
  )
}