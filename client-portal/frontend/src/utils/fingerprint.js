// Simple client-side device fingerprinting helper
export function getDeviceFingerprint() {
  const userAgent = navigator.userAgent;
  const language = navigator.language || navigator.userLanguage || 'en-US';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  
  // Simple OS detection
  let os = 'Unknown OS';
  if (userAgent.indexOf('Win') !== -1) os = 'Windows';
  else if (userAgent.indexOf('Mac') !== -1) os = 'MacOS';
  else if (userAgent.indexOf('X11') !== -1) os = 'UNIX';
  else if (userAgent.indexOf('Linux') !== -1) os = 'Linux';
  else if (userAgent.indexOf('Android') !== -1) os = 'Android';
  else if (userAgent.indexOf('like Mac') !== -1) os = 'iOS';

  // Simple Browser detection
  let browser = 'Unknown Browser';
  if (userAgent.indexOf('Chrome') !== -1) browser = 'Chrome';
  else if (userAgent.indexOf('Safari') !== -1) browser = 'Safari';
  else if (userAgent.indexOf('Firefox') !== -1) browser = 'Firefox';
  else if (userAgent.indexOf('MSIE') !== -1 || !!document.documentMode === true) browser = 'IE';

  // Simple Device Type detection
  let deviceType = 'Desktop';
  if (/Mobi|Android|iPhone|iPad/i.test(userAgent)) {
    deviceType = 'Mobile';
  }

  // Create a simple hash string
  const rawString = `${os}-${browser}-${deviceType}-${timezone}-${language}`;
  let hash = 0;
  for (let i = 0; i < rawString.length; i++) {
    const char = rawString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const fingerprintHash = Math.abs(hash).toString(16);

  return {
    os,
    browser,
    deviceType,
    timezone,
    language,
    fingerprintHash,
  };
}
