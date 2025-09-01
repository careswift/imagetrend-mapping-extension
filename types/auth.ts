export interface TokenResponse {
  access_token: string
  id_token?: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope?: string
}

export interface UserInfo {
  sub: string
  email: string
  name?: string
  preferred_username?: string
}

export interface AuthState {
  isAuthenticated: boolean
  user?: UserInfo
  accessToken?: string
  expiresAt?: number
}

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}