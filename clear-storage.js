#!/usr/bin/env node

/**
 * Script to clear Chrome extension storage when quota is exceeded
 * Run this when you get "Resource::kQuotaBytes quota exceeded" error
 */

console.log('To clear the extension storage:');
console.log('1. Open Chrome DevTools for the extension');
console.log('2. Go to chrome://extensions/');
console.log('3. Enable Developer mode');
console.log('4. Find "CareSwift ImageTrend Mapping" extension');
console.log('5. Click "service worker" or "background page"');
console.log('6. In the console, run:');
console.log('');
console.log('// Clear all storage except auth tokens');
console.log(`
chrome.storage.local.get(null).then(data => {
  const essentialKeys = ['okta_tokens'];
  const allKeys = Object.keys(data);
  const keysToRemove = allKeys.filter(key => !essentialKeys.includes(key));
  
  chrome.storage.local.remove(keysToRemove).then(() => {
    console.log('Cleared', keysToRemove.length, 'items from storage');
    
    // Check new storage usage
    chrome.storage.local.getBytesInUse().then(bytes => {
      const quota = chrome.storage.local.QUOTA_BYTES || 10485760;
      const percent = (bytes / quota * 100).toFixed(2);
      console.log('Storage usage after cleanup:', bytes, '/', quota, 'bytes (' + percent + '%)');
    });
  });
});
`);

console.log('');
console.log('Or to completely clear ALL storage (will require re-authentication):');
console.log('chrome.storage.local.clear()');