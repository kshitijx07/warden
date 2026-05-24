const geoip = require('geoip-lite');
const db = require('../config/db');

function sendLoginEventWebhook({
  employeeId,
  email,
  eventType,
  ipAddress,
  userAgent,
  deviceFingerprint,
}) {
  // Fire-and-forget asynchronous execution
  setImmediate(async () => {
    try {
      let geo = null;
      let checkIp = ipAddress;

      // Extract client IP (handle loopback overrides for geolocation testing)
      if (
        (ipAddress === '127.0.0.1' || ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1') &&
        deviceFingerprint &&
        deviceFingerprint.mockIp
      ) {
        checkIp = deviceFingerprint.mockIp;
      }

      const lookup = geoip.lookup(checkIp);
      if (lookup) {
        geo = {
          city: lookup.city || 'Unknown',
          country: lookup.country || 'Unknown',
          ll: lookup.ll || [0, 0], // [latitude, longitude]
        };
      } else {
        // Fallback for loopback connections if mockIp is missing or unresolved
        geo = {
          city: 'London',
          country: 'GB',
          ll: [51.5074, -0.1278],
        };
      }

      const fingerprint = {
        browser: (deviceFingerprint && deviceFingerprint.browser) || 'Unknown',
        os: (deviceFingerprint && deviceFingerprint.os) || 'Unknown',
        deviceType: (deviceFingerprint && deviceFingerprint.deviceType) || 'Desktop',
        timezone: (deviceFingerprint && deviceFingerprint.timezone) || 'UTC',
        language: (deviceFingerprint && deviceFingerprint.language) || 'en',
        fingerprintHash: (deviceFingerprint && deviceFingerprint.fingerprintHash) || 'unknown-hash',
        mockTimestamp: (deviceFingerprint && deviceFingerprint.mockTimestamp) || null,
      };

      const timestamp = (deviceFingerprint && deviceFingerprint.mockTimestamp) || new Date().toISOString();

      console.log(`[TELEMETRY] Buffering event locally: ${eventType} for ${email}`);

      // Insert event into local database table telemetry_events
      await db.query(
        `INSERT INTO telemetry_events (employee_id, email, event_type, ip_address, user_agent, device_fingerprint, geolocation, timestamp) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          employeeId || null,
          email,
          eventType,
          checkIp,
          userAgent || 'Unknown',
          JSON.stringify(fingerprint),
          JSON.stringify(geo),
          timestamp
        ]
      );
    } catch (error) {
      console.error('[TELEMETRY ERROR] Failed to buffer event:', error.message);
    }
  });
}

module.exports = {
  sendLoginEventWebhook,
};
