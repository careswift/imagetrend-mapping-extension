import { oktaAuth } from "./auth"
import type { ApiResponse } from "~types/auth"
import { CompanyCache } from "~utils/company-cache"

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
  
  /**
   * Compress data using the Compression Streams API
   * Falls back to uncompressed if not supported
   */
  private async compressData(data: any): Promise<{ body: ArrayBuffer | string; encoding?: string }> {
    // Check if Compression Streams API is available
    if (typeof CompressionStream === 'undefined') {
      console.warn('[API] Compression Streams API not available, sending uncompressed')
      return { body: JSON.stringify(data) }
    }
    
    try {
      const jsonString = JSON.stringify(data)
      const stream = new Blob([jsonString], {
        type: 'application/json',
      }).stream()
      
      // Use gzip compression
      const compressedStream = stream.pipeThrough(
        new CompressionStream("gzip")
      )
      
      const response = new Response(compressedStream)
      const blob = await response.blob()
      const compressed = await blob.arrayBuffer()
      
      // Log compression ratio
      const originalSize = new Blob([jsonString]).size
      const compressedSize = compressed.byteLength
      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(2)
      console.log(`[API] Compression: ${originalSize} → ${compressedSize} bytes (${ratio}% reduction)`)
      
      return { body: compressed, encoding: 'gzip' }
    } catch (error) {
      console.error('[API] Compression failed, sending uncompressed:', error)
      return { body: JSON.stringify(data) }
    }
  }

  async sendFormMapping(data: any): Promise<ApiResponse> {
    const currentUrl = data.url || data.form_url
    
    if (!currentUrl) {
      return {
        success: false,
        error: 'No form URL provided'
      }
    }
    
    // Look up company first
    const companyLookup = await this.lookupCompanyByURL(currentUrl)
    
    if (!companyLookup.success || !companyLookup.data) {
      return {
        success: false,
        error: companyLookup.error || 'No company registered for this ImageTrend instance. Please contact your administrator.'
      }
    }
    
    // Log for debugging
    console.log('[API] Submitting data for company:', companyLookup.data.company_name)
    
    // Prepare the payload with company context
    const enrichedData = {
      company_id: companyLookup.data.company_id,
      form_url: currentUrl,
      payload: {
        ...data,
        _metadata: {
          company_id: companyLookup.data.company_id,
          company_name: companyLookup.data.company_name,
          extracted_at: new Date().toISOString(),
          extension_version: chrome.runtime.getManifest().version
        }
      }
    }
    
    const path = process.env.PLASMO_PUBLIC_API_MAPPING_PATH || '/api/v1/admin/vendor-forms/ingest'
    
    try {
      // Compress the payload - API now supports gzip decompression
      const { body, encoding } = await this.compressData(enrichedData)
      
      // Prepare request options
      const requestOptions: any = {
        method: 'POST',
        body: body
      }
      
      // Add compression header if compressed
      if (encoding) {
        requestOptions.headers = {
          'Content-Encoding': encoding,
          'Content-Type': 'application/json'
        }
      }
      
      const response = await this.makeRequest(path, requestOptions)
      
      if (response.success) {
        // Update last extraction time for this company
        const cache = new CompanyCache()
        await cache.set(currentUrl, {
          ...companyLookup.data,
          last_extraction: new Date().toISOString(),
          extraction_count: (companyLookup.data.extraction_count || 0) + 1
        })
      }
      
      return response
    } catch (error: any) {
      console.error('[API] Form submission error:', error)
      return {
        success: false,
        error: error.message || 'Failed to submit form data'
      }
    }
  }
  
  async validateAuth(): Promise<ApiResponse<{ valid: boolean; user?: any }>> {
    const path = process.env.PLASMO_PUBLIC_API_AUTH_PATH || '/api/v1/auth/validate'
    return await this.makeRequest(path, {
      method: 'GET'
    })
  }
  
  async lookupCompanyByURL(url: string): Promise<ApiResponse<{ company_id: string; company_name: string; last_extraction?: string; extraction_count?: number }>> {
    const lookupPath = process.env.PLASMO_PUBLIC_API_LOOKUP_PATH || '/api/v1/admin/vendor-forms/lookup'
    
    // Check cache first
    const cache = new CompanyCache()
    const cached = await cache.get(url)
    if (cached) {
      console.log('[API] Using cached company info')
      return {
        success: true,
        data: cached
      }
    }
    
    // Extract agency code from URL
    const agencyCode = this.extractAgencyCode(url)
    if (!agencyCode) {
      return {
        success: false,
        error: 'Invalid ImageTrend URL - no agency code found'
      }
    }
    
    try {
      // Use agency code for lookup instead of full URL
      const response = await this.makeRequest(
        `${lookupPath}?agency=${encodeURIComponent(agencyCode)}`,
        { method: 'GET' }
      )
      
      if (response.success && response.data) {
        // Cache the result
        await cache.set(url, response.data)
      }
      
      return response
    } catch (error: any) {
      console.error('Failed to lookup company by agency:', error)
      
      // Provide more specific error messages
      if (error.message?.includes('404')) {
        return {
          success: false,
          error: 'No company found for this ImageTrend URL'
        }
      }
      
      if (error.message?.includes('network')) {
        return {
          success: false,
          error: 'Network error - please check your connection'
        }
      }
      
      return {
        success: false,
        error: error.message || 'Failed to lookup company'
      }
    }
  }
  
  private extractAgencyCode(url: string): string | null {
    // Pattern: /RunForm/Agency[AGENCY_CODE]/
    const match = url.match(/\/RunForm\/Agency([^\/]+)\//i)
    return match ? match[1] : null
  }
  
  async getExtractionHistory(url: string): Promise<ApiResponse<{ history: any[]; total_count: number }>> {
    const historyPath = process.env.PLASMO_PUBLIC_API_HISTORY_PATH || '/api/v1/admin/vendor-forms/history'
    
    try {
      const response = await this.makeRequest(`${historyPath}?url=${encodeURIComponent(url)}`, {
        method: 'GET'
      })
      
      return response
    } catch (error) {
      console.error('Failed to get extraction history:', error)
      return {
        success: false,
        error: 'Failed to get extraction history'
      }
    }
  }
}

export const apiClient = new ApiClient()