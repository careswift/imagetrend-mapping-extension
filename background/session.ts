interface SessionData {
  companyId: string
  companyName: string
  agencyCode: string
  establishedAt: number
  lastActivity: number
}

// Helper function to extract agency code from URL
function extractAgencyCode(url: string): string | null {
  // Pattern: /RunForm/Agency[AGENCY_CODE]/
  const match = url.match(/\/RunForm\/Agency([^\/]+)\//i)
  return match ? match[1] : null
}

export class CompanySessionManager {
  private static SESSION_KEY = 'active_company_session'
  private static SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes
  
  async getActiveSession(): Promise<SessionData | null> {
    const result = await chrome.storage.session.get(CompanySessionManager.SESSION_KEY)
    const session = result[CompanySessionManager.SESSION_KEY] as SessionData | undefined
    
    if (!session) {
      return null
    }
    
    // Check if session is still valid
    const age = Date.now() - session.lastActivity
    if (age > CompanySessionManager.SESSION_TIMEOUT) {
      await this.clearSession()
      return null
    }
    
    return session
  }
  
  async setActiveSession(companyId: string, companyName: string, url: string): Promise<void> {
    const agencyCode = extractAgencyCode(url) || ''
    const session: SessionData = {
      companyId,
      companyName,
      agencyCode,
      establishedAt: Date.now(),
      lastActivity: Date.now()
    }
    
    await chrome.storage.session.set({
      [CompanySessionManager.SESSION_KEY]: session
    })
  }
  
  async updateActivity(): Promise<void> {
    const session = await this.getActiveSession()
    if (session) {
      session.lastActivity = Date.now()
      await chrome.storage.session.set({
        [CompanySessionManager.SESSION_KEY]: session
      })
    }
  }
  
  async clearSession(): Promise<void> {
    await chrome.storage.session.remove(CompanySessionManager.SESSION_KEY)
  }
  
  async isCurrentAgency(url: string): Promise<boolean> {
    const session = await this.getActiveSession()
    if (!session) {
      return false
    }
    
    const agencyCode = extractAgencyCode(url)
    return agencyCode === session.agencyCode
  }
}