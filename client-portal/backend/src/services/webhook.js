const geoip = require('geoip-lite');
require('dotenv').config();

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

      const payload = {
        employeeId: employeeId || null,
        email,
        companyId: process.env.TENANT_ID,
        eventType,
        timestamp: (deviceFingerprint && deviceFingerprint.mockTimestamp) || new Date().toISOString(),
        ipAddress: checkIp,
        userAgent: userAgent || 'Unknown',
        deviceFingerprint: {
          browser: (deviceFingerprint && deviceFingerprint.browser) || 'Unknown',
          os: (deviceFingerprint && deviceFingerprint.os) || 'Unknown',
          deviceType: (deviceFingerprint && deviceFingerprint.deviceType) || 'Desktop',
          timezone: (deviceFingerprint && deviceFingerprint.timezone) || 'UTC',
          language: (deviceFingerprint && deviceFingerprint.language) || 'en',
          fingerprintHash: (deviceFingerprint && deviceFingerprint.fingerprintHash) || 'unknown-hash',
        },
        geolocation: geo,
      };

      console.log(`Sending webhook event to Central: ${eventType} for ${email}`);

      const response = await fetch(process.env.CENTRAL_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.CENTRAL_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Central Ingest failed with status: ${response.status}`);
      } else {
        console.log(`Central Ingest successful for: ${email}`);
      }
    } catch (error) {
      console.error('Failed to send webhook to Central:', error.message);
    }
  });
}

module.exports = {
  sendLoginEventWebhook,
};
