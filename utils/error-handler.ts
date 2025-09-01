export enum ErrorType {
  AUTH_FAILED = 'AUTH_FAILED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  EXTRACTION_ERROR = 'EXTRACTION_ERROR'
}

export class AppError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public details?: any
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function handleError(error: any): AppError {
  if (error instanceof AppError) {
    return error
  }
  
  if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
    return new AppError(ErrorType.TOKEN_EXPIRED, 'Authentication expired', error)
  }
  
  if (error.message?.includes('network') || error.message?.includes('fetch')) {
    return new AppError(ErrorType.NETWORK_ERROR, 'Network error occurred', error)
  }
  
  return new AppError(ErrorType.API_ERROR, error.message || 'Unknown error', error)
}

export function showUserError(error: AppError): void {
  // In production, could integrate with a toast notification system
  console.error(`[${error.type}] ${error.message}`, error.details)
  
  // User-friendly messages
  const userMessages: Record<ErrorType, string> = {
    [ErrorType.AUTH_FAILED]: 'Login failed. Please try again.',
    [ErrorType.TOKEN_EXPIRED]: 'Your session has expired. Please login again.',
    [ErrorType.API_ERROR]: 'Failed to send data. Please try again later.',
    [ErrorType.NETWORK_ERROR]: 'Network error. Please check your connection.',
    [ErrorType.EXTRACTION_ERROR]: 'Failed to extract data from the page.'
  }
  
  const message = userMessages[error.type] || error.message
  
  // Send to popup for display
  chrome.runtime.sendMessage({
    type: 'SHOW_ERROR',
    error: {
      type: error.type,
      message
    }
  })
}