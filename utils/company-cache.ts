const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

interface CompanyInfo {
  company_id: string
  company_name: string
  last_extraction?: string
  extraction_count?: number
}

interface CachedCompany {
  data: CompanyInfo
  cached_at: number
}

// Helper function to extract agency code from URL
function extractAgencyCode(url: string): string | null {
  // Pattern: /RunForm/Agency[AGENCY_CODE]/
  const match = url.match(/\/RunForm\/Agency([^\/]+)\//i)
  return match ? match[1] : null
}

export class CompanyCache {
  private getCacheKey(url: string): string {
    // Extract agency code from URL for cache key
    const agencyCode = extractAgencyCode(url)
    if (agencyCode) {
      return `company_agency_${agencyCode}`
    }
    // Fallback to URL hash if no agency code found
    return `company_${btoa(url).substring(0, 10)}`
  }
  
  async get(url: string): Promise<CompanyInfo | null> {
    const key = this.getCacheKey(url)
    const result = await chrome.storage.local.get(key)
    
    if (!result[key]) {
      return null
    }
    
    const cached = result[key] as CachedCompany
    const age = Date.now() - cached.cached_at
    
    if (age > CACHE_DURATION) {
      // Cache expired
      await chrome.storage.local.remove(key)
      return null
    }
    
    return cached.data
  }
  
  async set(url: string, data: CompanyInfo): Promise<void> {
    const key = this.getCacheKey(url)
    await chrome.storage.local.set({
      [key]: {
        data,
        cached_at: Date.now()
      }
    })
  }
  
  async clear(url?: string): Promise<void> {
    if (url) {
      const key = this.getCacheKey(url)
      await chrome.storage.local.remove(key)
    } else {
      // Clear all company caches
      const storage = await chrome.storage.local.get()
      const companyKeys = Object.keys(storage).filter(k => k.startsWith('company_'))
      await chrome.storage.local.remove(companyKeys)
    }
  }
}