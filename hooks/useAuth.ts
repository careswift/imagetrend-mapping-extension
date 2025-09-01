import { useState, useEffect } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import type { UserInfo } from "~types/auth"

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Use storage hooks for reactive updates
  const [accessToken] = useStorage("access_token")
  const [storedUserInfo] = useStorage<UserInfo>("user_info")
  
  useEffect(() => {
    checkAuthState()
  }, [accessToken])
  
  useEffect(() => {
    if (storedUserInfo) {
      setUserInfo(storedUserInfo)
    }
  }, [storedUserInfo])
  
  const checkAuthState = async () => {
    console.log('[useAuth] Checking auth state...')
    setLoading(true)
    
    // Add a timeout in case the background script doesn't respond
    const timeoutId = setTimeout(() => {
      console.error('[useAuth] Auth state check timed out')
      setLoading(false)
      setIsAuthenticated(false)
    }, 5000)
    
    try {
      chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (response) => {
        clearTimeout(timeoutId)
        console.log('[useAuth] Auth state response:', response)
        
        if (chrome.runtime.lastError) {
          console.error('[useAuth] Chrome runtime error:', chrome.runtime.lastError)
          setLoading(false)
          setIsAuthenticated(false)
          return
        }
        
        if (response) {
          setIsAuthenticated(response.isAuthenticated || false)
          setUserInfo(response.userInfo || null)
        } else {
          console.warn('[useAuth] No response from background script')
          setIsAuthenticated(false)
        }
        setLoading(false)
      })
    } catch (error) {
      clearTimeout(timeoutId)
      console.error('[useAuth] Error checking auth state:', error)
      setLoading(false)
      setIsAuthenticated(false)
    }
  }
  
  const login = () => {
    chrome.runtime.sendMessage({ type: 'LOGIN' }, (response) => {
      if (response?.success) {
        // State will update automatically via storage hooks
        console.log('Login initiated')
      }
    })
  }
  
  const logout = () => {
    chrome.runtime.sendMessage({ type: 'LOGOUT' }, (response) => {
      if (response?.success) {
        setIsAuthenticated(false)
        setUserInfo(null)
      }
    })
  }
  
  return {
    isAuthenticated,
    userInfo,
    loading,
    login,
    logout
  }
}