const db = require('../config/db');
const { evaluateSecurityRules } = require('../engine/ruleEngine');
const { emitAlert } = require('./socket');
const { sendMfaChallengeCallback, sendLockAccountCallback } = require('./callbacks');

async function processTelemetryEvent(company, eventData) {
  const {
    employeeId,
    email,
    eventType,
    timestamp,
    ipAddress,
    userAgent,
    deviceFingerprint,
    geolocation,
  } = eventData;

  const companyId = company.id;

  // 1. Look up employee in registered roster
  const employeeRes = await db.query(
    'SELECT id FROM employees WHERE company_id = $1 AND external_employee_id = $2',
    [companyId, employeeId]
  );

  const isRosterEmployee = employeeRes.rows.length > 0;
  const finalEmployeeId = isRosterEmployee ? employeeId : null;

  // 2. Evaluate rules
  const evaluation = await evaluateSecurityRules({
    employeeId: finalEmployeeId,
    email,
    companyId,
    eventType: isRosterEmployee ? eventType : 'unknown_employee',
    timestamp,
    ipAddress,
    userAgent,
    deviceFingerprint,
    geolocation,
  });

  // 3. Log the Event in central DB
  const eventLogRes = await db.query(
    `INSERT INTO login_events (company_id, employee_id, email, event_type, ip_address, city, country, latitude, longitude, device_fingerprint, risk_score, timestamp) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      companyId,
      finalEmployeeId,
      email,
      isRosterEmployee ? eventType : 'unknown_employee',
      ipAddress,
      geolocation?.city || null,
      geolocation?.country || null,
      geolocation?.ll?.[0] || null,
      geolocation?.ll?.[1] || null,
      JSON.stringify(deviceFingerprint || {}),
      evaluation.totalScore,
      new Date(timestamp),
    ]
  );
  const eventLogId = eventLogRes.rows[0].id;

  // 4. Save Computed Risk Score
  await db.query(
    `INSERT INTO risk_scores (login_event_id, total_score, action_taken, score_breakdown_json) 
     VALUES ($1, $2, $3, $4)`,
    [eventLogId, evaluation.totalScore, evaluation.actionTaken, JSON.stringify(evaluation.breakdown)]
  );

  // 5. Process Enrichment & Baselines if employee exists
  if (finalEmployeeId) {
    if (eventType === 'logout') {
      await db.query(
        'UPDATE active_employee_sessions SET is_active = false WHERE company_id = $1 AND employee_id = $2',
        [companyId, finalEmployeeId]
      );
    } else {
      // Device fingerprint listing
      const incomingHash = deviceFingerprint?.fingerprintHash || 'unknown-hash';
      const devRes = await db.query(
        'SELECT id FROM device_history WHERE company_id = $1 AND employee_id = $2 AND fingerprint_hash = $3',
        [companyId, finalEmployeeId, incomingHash]
      );
      if (devRes.rows.length === 0) {
        await db.query(
          `INSERT INTO device_history (company_id, employee_id, fingerprint_hash) 
           VALUES ($1, $2, $3)`,
          [companyId, finalEmployeeId, incomingHash]
        );
      } else {
        await db.query(
          'UPDATE device_history SET last_seen = NOW() WHERE company_id = $1 AND employee_id = $2 AND fingerprint_hash = $3',
          [companyId, finalEmployeeId, incomingHash]
        );
      }

      // Update baseline last success coordinates if this was a safe success
      if (eventType === 'success') {
        await db.query(
          `UPDATE employees 
           SET is_locked = false, lock_until = null 
           WHERE company_id = $1 AND external_employee_id = $2`,
          [companyId, finalEmployeeId]
        );
      }

      if (eventType === 'success' && evaluation.totalScore <= 80) {
        const lastLat = geolocation?.ll?.[0];
        const lastLng = geolocation?.ll?.[1];

        // Check if baseline exists
        const baseRes = await db.query(
          'SELECT id FROM behavior_baselines WHERE company_id = $1 AND employee_id = $2',
          [companyId, finalEmployeeId]
        );

        if (baseRes.rows.length === 0) {
          await db.query(
            `INSERT INTO behavior_baselines (company_id, employee_id, last_successful_login_lat, last_successful_login_lng, last_successful_login_time) 
             VALUES ($1, $2, $3, $4, $5)`,
            [companyId, finalEmployeeId, lastLat, lastLng, new Date(timestamp)]
          );
        } else {
          await db.query(
            `UPDATE behavior_baselines 
             SET last_successful_login_lat = $1, last_successful_login_lng = $2, last_successful_login_time = $3 
             WHERE company_id = $4 AND employee_id = $5`,
            [lastLat, lastLng, new Date(timestamp), companyId, finalEmployeeId]
          );
        }

        // Upsert active employee session
        const clientSessionId = deviceFingerprint?.clientSessionId || '00000000-0000-0000-0000-000000000000'; // Default if not passed
        await db.query(
          `INSERT INTO active_employee_sessions (company_id, employee_id, client_session_id, ip_address, device_fingerprint_hash, is_active) 
           VALUES ($1, $2, $3, $4, $5, true)
           ON CONFLICT DO NOTHING`, // Simple session update
          [companyId, finalEmployeeId, clientSessionId, ipAddress, incomingHash]
        );
      }

      // If lockout or suspension, invalidate active sessions
      if (evaluation.actionTaken === 'account_locked' || eventType === 'locked') {
        await db.query(
          'UPDATE active_employee_sessions SET is_active = false WHERE company_id = $1 AND employee_id = $2',
          [companyId, finalEmployeeId]
        );
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lockout
        await db.query(
          `UPDATE employees 
           SET is_locked = true, lock_until = $1 
           WHERE company_id = $2 AND external_employee_id = $3`,
          [lockUntil, companyId, finalEmployeeId]
        );
      }
    }
  }

  // 6. Save Alerts & Broadcast
  for (const alertInfo of evaluation.alerts) {
    const alertInsertRes = await db.query(
      `INSERT INTO alerts (company_id, employee_id, email, login_event_id, severity, reason, status) 
       VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id, created_at`,
      [companyId, finalEmployeeId, email, eventLogId, alertInfo.severity, alertInfo.reason]
    );
    
    const fullAlert = {
      id: alertInsertRes.rows[0].id,
      company_id: companyId,
      company_name: company.name,
      employee_id: finalEmployeeId,
      email: email,
      severity: alertInfo.severity,
      reason: alertInfo.reason,
      status: 'active',
      created_at: alertInsertRes.rows[0].created_at,
      risk_score: evaluation.totalScore,
      score_breakdown_json: evaluation.breakdown,
    };

    // Broadcast alert via Socket.IO room
    emitAlert(companyId, fullAlert);
  }

  // 7. Execute callback actions asynchronously back to Client backend
  if (evaluation.actionTaken === 'mfa_required' && deviceFingerprint?.clientSessionId) {
    sendMfaChallengeCallback(company, deviceFingerprint.clientSessionId);
  } else if (evaluation.actionTaken === 'account_locked') {
    sendLockAccountCallback(company, email);
  }

  return {
    riskScore: evaluation.totalScore,
    actionTaken: evaluation.actionTaken,
  };
}

module.exports = {
  processTelemetryEvent,
};
