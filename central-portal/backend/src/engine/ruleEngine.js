const db = require('../config/db');

let settingsCache = {};

async function refreshSettings() {
  try {
    const res = await db.query('SELECT key, value FROM system_settings');
    const settings = {};
    res.rows.forEach(r => {
      settings[r.key] = r.value;
    });
    settingsCache = settings;
    console.log('[RULE ENGINE] System settings cache loaded/refreshed');
  } catch (err) {
    console.error('[RULE ENGINE] Failed to load settings from DB:', err);
  }
}

// Initial load
refreshSettings();

function getSetting(key, defaultValue) {
  if (settingsCache[key] !== undefined) {
    const val = parseFloat(settingsCache[key]);
    return isNaN(val) ? defaultValue : val;
  }
  return defaultValue;
}

// Helper to calculate Haversine distance between two coordinates in km
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function evaluateSecurityRules(payload) {
  const {
    employeeId,
    email,
    companyId,
    eventType,
    timestamp,
    ipAddress,
    userAgent,
    deviceFingerprint,
    geolocation,
  } = payload;

  // Initialize scoring metrics
  let totalScore = 0;
  const breakdown = {
    failed_logins: { score: 0, details: 'No failed login anomalies' },
    time_of_day: { score: 0, details: 'Login within normal baseline hours' },
    device_fingerprint: { score: 0, details: 'Recognized device fingerprint' },
    geolocation: { score: 0, details: 'Matches historical locations' },
    impossible_travel: { score: 0, details: 'No travel violations' },
    concurrent_session: { score: 0, details: 'No active concurrent sessions' },
  };

  const alertsToRaise = [];
  const parsedTime = new Date(timestamp);
  const eventHour = parsedTime.getUTCHours();

  // If employee is an anomaly (mismatch on roster)
  if (!employeeId) {
    return {
      totalScore: 100,
      actionTaken: 'account_locked',
      breakdown: {
        ...breakdown,
        roster_mismatch: { score: 100, details: `Unknown employee email: ${email}` },
      },
      alerts: [
        {
          severity: 'high',
          reason: `Anomaly: Event ingestion reported email ${email} which is absent from registered company roster.`,
        },
      ],
    };
  }

  // Fetch baseline parameters for comparison
  let baseline = null;
  const baselineRes = await db.query(
    'SELECT * FROM behavior_baselines WHERE company_id = $1 AND employee_id = $2',
    [companyId, employeeId]
  );
  if (baselineRes.rows.length > 0) {
    baseline = baselineRes.rows[0];
  }

  // ==========================================
  // Rule 1: Failed Logins
  // ==========================================
  let consecutiveFailures = 0;
  
  // Fetch central history
  const failedEvents = await db.query(
    `SELECT event_type FROM login_events 
     WHERE company_id = $1 AND employee_id = $2 AND timestamp >= NOW() - INTERVAL '15 minutes' 
     ORDER BY timestamp DESC`,
    [companyId, employeeId]
  );

  for (const row of failedEvents.rows) {
    if (row.event_type === 'failure' || row.event_type === 'locked') {
      consecutiveFailures++;
    } else if (row.event_type === 'success') {
      break;
    }
  }

  // Include current event if it's a failure
  const isCurrentFailure = eventType === 'failure' || eventType === 'locked';
  if (isCurrentFailure) {
    consecutiveFailures++;
    // Add points for each wrong password attempt in history based on dynamic weight
    const weightFailedLogin = getSetting('weight_failed_login', 10);
    const failedScore = weightFailedLogin * consecutiveFailures;
    totalScore += failedScore;
    breakdown.failed_logins.score = failedScore;
    breakdown.failed_logins.details = `${consecutiveFailures} consecutive failed login attempts.`;
  }

  // Alert generation on failures count based on dynamic limits
  const failuresLockout = getSetting('failures_lockout', 7);
  const failuresBlock = getSetting('failures_block', 5);
  const failuresWarn = getSetting('failures_warn', 3);

  if (consecutiveFailures >= failuresLockout) {
    alertsToRaise.push({
      severity: 'critical',
      reason: `Critical: ${consecutiveFailures} consecutive failed login attempts detected. Enforced temporary lockout.`,
    });
  } else if (consecutiveFailures >= failuresBlock) {
    alertsToRaise.push({
      severity: 'high',
      reason: `Warning: ${consecutiveFailures} consecutive failed login attempts. Verification block recommended.`,
    });
  } else if (consecutiveFailures >= failuresWarn) {
    alertsToRaise.push({
      severity: 'medium',
      reason: `Warning: ${consecutiveFailures} consecutive failed login attempts.`,
    });
  }

  // ==========================================
  // Rule 2: Time-of-Day Analysis
  // ==========================================
  const startHour = baseline ? baseline.avg_login_hour_start : 8;
  const endHour = baseline ? baseline.avg_login_hour_end : 18;

  let outsideHours = false;
  if (startHour <= endHour) {
    outsideHours = eventHour < startHour || eventHour > endHour;
  } else {
    // Night shift wrapping around midnight
    outsideHours = eventHour < startHour && eventHour > endHour;
  }

  if (outsideHours) {
    const weightTimeOfDay = getSetting('weight_time_of_day', 15);
    totalScore += weightTimeOfDay;
    breakdown.time_of_day.score = weightTimeOfDay;
    breakdown.time_of_day.details = `Login hour ${eventHour}:00 UTC falls outside normal window (${startHour}:00 - ${endHour}:00 UTC).`;
    const eventTypeLabel = eventType === 'success' ? 'Successful login' : 'Failed login attempt';
    alertsToRaise.push({
      severity: 'medium',
      reason: `Suspicious: ${eventTypeLabel} occurred outside normal hours (hour: ${eventHour}:00 UTC).`,
    });
  }

  // ==========================================
  // Rule 3: Device & Browser Fingerprint
  // ==========================================
  const incomingHash = deviceFingerprint?.fingerprintHash || 'unknown-hash';
  const deviceHistoryRes = await db.query(
    'SELECT * FROM device_history WHERE company_id = $1 AND employee_id = $2 AND fingerprint_hash = $3',
    [companyId, employeeId, incomingHash]
  );

  const isNewDevice = deviceHistoryRes.rows.length === 0;
  if (isNewDevice) {
    const weightNewDevice = getSetting('weight_new_device', 25);
    totalScore += weightNewDevice;
    breakdown.device_fingerprint.score = weightNewDevice;
    breakdown.device_fingerprint.details = `Unrecognized device fingerprint: ${incomingHash}`;
    alertsToRaise.push({
      severity: 'medium',
      reason: `New Device: Unrecognized login fingerprint detected (${deviceFingerprint.os || 'Unknown OS'} / ${deviceFingerprint.browser || 'Unknown Browser'}).`,
    });
  }

  // ==========================================
  // Rule 4: Geolocation Monitoring
  // ==========================================
  const currentCity = geolocation?.city || 'Unknown';
  const currentCountry = geolocation?.country || 'Unknown';
  const currentLat = geolocation?.ll?.[0];
  const currentLng = geolocation?.ll?.[1];

  let geoViolation = false;
  if (baseline) {
    const commonCountries = baseline.common_countries || [];
    
    // Check country
    const isNewCountry = commonCountries.length > 0 && !commonCountries.includes(currentCountry);
    const isHighRiskCountry = ['RU', 'KP', 'CN'].includes(currentCountry);

    if (isHighRiskCountry) {
      const weightHighRisk = getSetting('weight_high_risk_country', 30);
      totalScore += weightHighRisk;
      breakdown.geolocation.score = weightHighRisk;
      breakdown.geolocation.details = `Login from high-risk country: ${currentCountry}`;
      alertsToRaise.push({
        severity: 'high',
        reason: `High Severity: Login attempted from high-risk country: ${currentCountry} (${currentCity}).`,
      });
      geoViolation = true;
    } else if (isNewCountry) {
      const weightNewCountry = getSetting('weight_new_country', 30);
      totalScore += weightNewCountry;
      breakdown.geolocation.score = weightNewCountry;
      breakdown.geolocation.details = `Login from entirely new country: ${currentCountry}`;
      alertsToRaise.push({
        severity: 'high',
        reason: `High Severity: Login attempted from new country: ${currentCountry} (${currentCity}).`,
      });
      geoViolation = true;
    }

    // Check city if country is not a new country
    if (!geoViolation && baseline.last_successful_login_lat && baseline.last_successful_login_lng) {
      // If distance from last successful city coordinate is > 100km, flag city mismatch
      const dist = calculateDistance(
        currentLat,
        currentLng,
        parseFloat(baseline.last_successful_login_lat),
        parseFloat(baseline.last_successful_login_lng)
      );

      const limitGeoDist = getSetting('limit_geo_distance', 100);
      if (dist > limitGeoDist) {
        const weightGeoDist = getSetting('weight_geo_distance', 20);
        totalScore += weightGeoDist;
        breakdown.geolocation.score = weightGeoDist;
        breakdown.geolocation.details = `Location differs from baseline. Current city: ${currentCity}, distance: ${Math.round(dist)}km`;
        alertsToRaise.push({
          severity: 'medium',
          reason: `Suspicious Location: Login location ${currentCity} is ${Math.round(dist)}km away from usual workspace.`,
        });
      }
    }
  }

  // ==========================================
  // Rule 5: Impossible Travel Rule
  // ==========================================
  let travelLocked = false;
  if (
    baseline &&
    baseline.last_successful_login_lat &&
    baseline.last_successful_login_lng &&
    baseline.last_successful_login_time &&
    currentLat &&
    currentLng
  ) {
    const lastLat = parseFloat(baseline.last_successful_login_lat);
    const lastLng = parseFloat(baseline.last_successful_login_lng);
    const lastTime = new Date(baseline.last_successful_login_time);

    const distance = calculateDistance(lastLat, lastLng, currentLat, currentLng);
    const timeDiffHours = (parsedTime - lastTime) / (1000 * 3600); // Difference in hours

    if (timeDiffHours > 0) {
      const speed = distance / timeDiffHours;
      const limitSpeed = getSetting('limit_impossible_travel_speed', 1000);
      const limitDist = getSetting('limit_geo_distance', 100);
      if (speed > limitSpeed && distance > limitDist) {
        // Impossible travel detected!
        totalScore = 100;
        breakdown.impossible_travel.score = 100;
        breakdown.impossible_travel.details = `Impossible travel: covered ${Math.round(distance)}km in ${timeDiffHours.toFixed(2)}h (${Math.round(speed)} km/h).`;
        alertsToRaise.push({
          severity: 'critical',
          reason: `Critical Anomaly: Impossible travel speed computed (${Math.round(speed)} km/h) between logins.`,
        });
        travelLocked = true;
      }
    }
  }

  // ==========================================
  // Rule 6: Concurrent Session Detection
  // ==========================================
  const activeSessionsRes = await db.query(
    'SELECT * FROM active_employee_sessions WHERE employee_id = $1 AND is_active = true',
    [employeeId]
  );

  if (activeSessionsRes.rows.length > 0) {
    let hasConflict = false;
    for (const session of activeSessionsRes.rows) {
      if (session.ip_address !== ipAddress || session.device_fingerprint_hash !== incomingHash) {
        hasConflict = true;
        break;
      }
    }

    if (hasConflict) {
      const weightConcurrent = getSetting('weight_concurrent_session', 15);
      totalScore += weightConcurrent;
      breakdown.concurrent_session.score = weightConcurrent;
      breakdown.concurrent_session.details = `${activeSessionsRes.rows.length} concurrent session(s) active on other devices.`;
      alertsToRaise.push({
        severity: 'medium',
        reason: `Suspicious: Concurrent active session detected from another device or location.`,
      });
    }
  }

  // Cap total score at 100
  totalScore = Math.min(totalScore, 100);

  // Determine actions based on thresholds
  let actionTaken = 'allow';
  const threshLockout = getSetting('threshold_lockout', 81);
  const threshBlock = getSetting('threshold_block', 61);
  const threshMfa = getSetting('threshold_mfa', 31);

  if (totalScore >= threshLockout || travelLocked || consecutiveFailures >= failuresLockout) {
    actionTaken = 'account_locked';
  } else if (totalScore >= threshBlock) {
    actionTaken = 'block_recommended';
  } else if (totalScore >= threshMfa) {
    actionTaken = 'mfa_required';
  }

  return {
    totalScore,
    actionTaken,
    breakdown,
    alerts: alertsToRaise,
  };
}

module.exports = {
  evaluateSecurityRules,
  refreshSettings,
};
