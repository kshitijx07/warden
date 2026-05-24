const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { progressiveDelayMiddleware, getConsecutiveFailures } = require('../middleware/progressiveDelay');
const { sendLoginEventWebhook } = require('../services/webhook');

const router = express.Router();

// Helper to hash JWT token for DB comparison
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// 1. Employee Login Route
router.post(
  '/login',
  body('email').isEmail().withMessage('Please enter a valid email address'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  progressiveDelayMiddleware,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, deviceFingerprint } = req.body;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    try {
      // Look up employee
      const employeeQuery = await db.query('SELECT * FROM employees WHERE email = $1', [email]);
      
      if (employeeQuery.rows.length === 0) {
        // Log attempt as failed
        await db.query(
          `INSERT INTO login_attempts (email, ip_address, device_fingerprint, success, reason) 
           VALUES ($1, $2, $3, false, 'Employee not found')`,
          [email, ipAddress, JSON.stringify(deviceFingerprint || {})]
        );

        // Fire fire-and-forget webhook to Central
        sendLoginEventWebhook({
          employeeId: null,
          email,
          eventType: 'failure',
          ipAddress,
          userAgent,
          deviceFingerprint,
        });

        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const employee = employeeQuery.rows[0];

      // Double-check lockout status (already checked in middleware, but as safety check)
      if (employee.is_locked) {
        const isExpired = employee.lock_until && new Date(employee.lock_until) <= new Date();
        if (!isExpired) {
          const remainingSeconds = employee.lock_until 
            ? Math.ceil((new Date(employee.lock_until) - new Date()) / 1000)
            : -1; // -1 indicates permanent/indefinite lock

          return res.status(423).json({
            status: 'locked',
            message: remainingSeconds === -1 
              ? 'Account has been locked by an administrator.' 
              : 'Account is temporarily locked due to excessive failed attempts.',
            lockoutRemaining: remainingSeconds,
          });
        }
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, employee.password_hash);

      if (!passwordMatch) {
        // Increment consecutive failures count
        const newConsecFailures = req.consecutiveFailures + 1;
        let isLocked = false;
        let lockUntil = null;

        if (newConsecFailures >= 7) {
          isLocked = true;
          lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes lock
          await db.query(
            'UPDATE employees SET is_locked = true, lock_until = $1, failed_attempts = $2 WHERE id = $3',
            [lockUntil, newConsecFailures, employee.id]
          );
        } else {
          await db.query(
            'UPDATE employees SET failed_attempts = $1 WHERE id = $2',
            [newConsecFailures, employee.id]
          );
        }

        // Log failed attempt
        await db.query(
          `INSERT INTO login_attempts (email, ip_address, device_fingerprint, success, reason) 
           VALUES ($1, $2, $3, false, 'Incorrect password')`,
          [email, ipAddress, JSON.stringify(deviceFingerprint || {})]
        );

        // Fire webhook to Central
        sendLoginEventWebhook({
          employeeId: employee.id,
          email,
          eventType: isLocked ? 'locked' : 'failure',
          ipAddress,
          userAgent,
          deviceFingerprint,
        });

        if (isLocked) {
          return res.status(423).json({
            status: 'locked',
            message: 'Account has been temporarily locked for 15 minutes due to excessive failed attempts.',
            lockoutRemaining: 15 * 60,
          });
        }

        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Password matches - Reset failure parameters
      await db.query(
        'UPDATE employees SET is_locked = false, lock_until = null, failed_attempts = 0, last_login = NOW() WHERE id = $1',
        [employee.id]
      );

      // Create new session
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiration for access token

      // Generate JWT
      const token = jwt.sign(
        { sessionId, employeeId: employee.id, email: employee.email },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const tokenHash = hashToken(token);

      // Generate Refresh Token
      const refreshToken = crypto.randomBytes(32).toString('hex');
      const refreshTokenHash = hashToken(refreshToken);
      const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days expiration for refresh token

      // Save session in local database
      await db.query(
        `INSERT INTO sessions (id, employee_id, token_hash, device_fingerprint, ip_address, status, expires_at, refresh_token_hash, refresh_expires_at) 
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)`,
        [sessionId, employee.id, tokenHash, JSON.stringify(deviceFingerprint || {}), ipAddress, expiresAt, refreshTokenHash, refreshExpiresAt]
      );

      // Set cookie
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: false, // set true in production
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // Log successful attempt
      await db.query(
        `INSERT INTO login_attempts (email, ip_address, device_fingerprint, success, reason) 
         VALUES ($1, $2, $3, true, 'Success')`,
        [email, ipAddress, JSON.stringify(deviceFingerprint || {})]
      );

      // Fire fire-and-forget success webhook to Central
      sendLoginEventWebhook({
        employeeId: employee.id,
        email,
        eventType: 'success',
        ipAddress,
        userAgent,
        deviceFingerprint,
      });

      return res.status(200).json({
        message: 'Login successful',
        token,
        refreshToken, // Fallback for clients not supporting cookies
        user: { id: employee.id, email: employee.email },
      });
    } catch (error) {
      console.error('Login route error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// 2. Validate OTP Route
router.post('/verify-otp', async (req, res) => {
  const { sessionId, otpCode } = req.body;
  if (!sessionId || !otpCode) {
    return res.status(400).json({ message: 'Session ID and OTP code are required' });
  }

  try {
    const challengeRes = await db.query(
      `SELECT * FROM otp_challenges 
       WHERE session_id = $1 AND verified = false AND expires_at > NOW() 
       ORDER BY id DESC LIMIT 1`,
      [sessionId]
    );

    if (challengeRes.rows.length === 0) {
      return res.status(400).json({ message: 'OTP expired, verified, or invalid session.' });
    }

    const challenge = challengeRes.rows[0];

    if (challenge.otp_code !== otpCode) {
      // Increment attempt counter
      await db.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
      return res.status(400).json({ message: 'Invalid OTP code.' });
    }

    // Set verified
    await db.query('UPDATE otp_challenges SET verified = true WHERE id = $1', [challenge.id]);
    
    // Update session status to active
    await db.query("UPDATE sessions SET status = 'active' WHERE id = $1", [sessionId]);

    return res.status(200).json({ success: true, message: 'OTP verified. Session activated.' });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Middleware to verify HMAC-SHA256 signature on callback requests from Central
function verifyCallbackSignature(req, res, next) {
  const signature = req.headers['x-warden-signature'];
  if (!signature) {
    return res.status(401).json({ message: 'Missing X-Warden-Signature header' });
  }

  const rawBody = JSON.stringify(req.body);
  const computedSignature = crypto
    .createHmac('sha256', process.env.CENTRAL_API_KEY)
    .update(rawBody)
    .digest('hex');

  if (computedSignature !== signature) {
    console.error(`[HMAC ERROR] Signature validation failed! Computed: ${computedSignature}, Received: ${signature}`);
    return res.status(401).json({ message: 'Invalid callback HMAC signature' });
  }
  next();
}

// Middleware to verify GET requests using header signature
function verifyGetCallbackSignature(req, res, next) {
  const signature = req.headers['x-warden-signature'];
  const payloadStr = req.headers['x-warden-payload'];
  if (!signature || !payloadStr) {
    return res.status(401).json({ message: 'Missing signature or payload headers' });
  }

  const computedSignature = crypto
    .createHmac('sha256', process.env.CENTRAL_API_KEY)
    .update(payloadStr)
    .digest('hex');

  if (computedSignature !== signature) {
    console.error(`[HMAC ERROR] GET Signature validation failed!`);
    return res.status(401).json({ message: 'Invalid GET callback HMAC signature' });
  }

  try {
    const payload = JSON.parse(payloadStr);
    const timeDiff = Math.abs(new Date() - new Date(payload.timestamp));
    if (timeDiff > 5 * 60 * 1000) {
      return res.status(401).json({ message: 'Callback request expired (anti-replay check failed)' });
    }
    req.callbackPayload = payload;
  } catch (err) {
    return res.status(400).json({ message: 'Invalid payload JSON structure' });
  }
  next();
}

// 3.8 Admin Callback: Telemetry Event Stream (Pull)
router.get('/callback/telemetry', verifyGetCallbackSignature, async (req, res) => {
  const incomingApiKey = req.headers['x-api-key'];
  if (incomingApiKey !== process.env.CENTRAL_API_KEY) {
    return res.status(401).json({ message: 'Unauthorized API Key' });
  }

  const lastId = parseInt(req.query.lastId || '0', 10);

  try {
    const eventsRes = await db.query(
      `SELECT * FROM telemetry_events 
       WHERE id > $1 
       ORDER BY id ASC LIMIT 100`,
      [lastId]
    );

    const formattedEvents = eventsRes.rows.map(row => ({
      id: row.id,
      employeeId: row.employee_id,
      email: row.email,
      companyId: process.env.TENANT_ID,
      eventType: row.event_type,
      timestamp: row.timestamp,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      deviceFingerprint: row.device_fingerprint,
      geolocation: row.geolocation,
    }));

    return res.status(200).json({ events: formattedEvents });
  } catch (error) {
    console.error('Fetch telemetry callback error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 3. Admin Callback: Challenge MFA
router.post('/callback/challenge-mfa', verifyCallbackSignature, async (req, res) => {
  const incomingApiKey = req.headers['x-api-key'];
  if (incomingApiKey !== process.env.CENTRAL_API_KEY) {
    return res.status(401).json({ message: 'Unauthorized API Key' });
  }

  const { sessionId, companyId } = req.body;
  if (companyId !== process.env.TENANT_ID) {
    return res.status(400).json({ message: 'Tenant mismatch' });
  }

  try {
    const sessionRes = await db.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Generate 6-digit OTP code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

    // Put session into mfa_pending status
    await db.query("UPDATE sessions SET status = 'mfa_pending' WHERE id = $1", [sessionId]);

    // Insert OTP challenge
    await db.query(
      `INSERT INTO otp_challenges (session_id, otp_code, expires_at) 
       VALUES ($1, $2, $3)`,
      [sessionId, otpCode, expiresAt]
    );

    // Print to logs for testing
    console.log(`\n======================================================`);
    console.log(`[MFA CALLBACK RECEIVED] Central requested MFA verification.`);
    console.log(`Session: ${sessionId}`);
    console.log(`Generated OTP code: ${otpCode} (Valid for 5m)`);
    console.log(`======================================================\n`);

    return res.status(200).json({ message: 'MFA challenge generated successfully' });
  } catch (error) {
    console.error('Challenge MFA callback error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});



// 4. Admin Callback: Lock/Unlock Account
router.post('/callback/lock-employee', verifyCallbackSignature, async (req, res) => {
  const incomingApiKey = req.headers['x-api-key'];
  if (incomingApiKey !== process.env.CENTRAL_API_KEY) {
    return res.status(401).json({ message: 'Unauthorized API Key' });
  }

  const { email, companyId, unlock, permanent } = req.body;
  if (companyId !== process.env.TENANT_ID) {
    return res.status(400).json({ message: 'Tenant mismatch' });
  }

  try {
    if (unlock) {
      const employeeRes = await db.query(
        `UPDATE employees SET is_locked = false, lock_until = null, failed_attempts = 0 
         WHERE email = $1 RETURNING id`,
        [email]
      );

      if (employeeRes.rows.length === 0) {
        return res.status(404).json({ message: 'Employee not found' });
      }

      console.log(`\n======================================================`);
      console.log(`[UNLOCK CALLBACK RECEIVED] Central unlocked account ${email}`);
      console.log(`======================================================\n`);

      return res.status(200).json({ message: 'Employee successfully unlocked' });
    } else {
      const lockUntil = permanent ? null : new Date(Date.now() + 15 * 60 * 1000); // null for permanent, 15m for temp

      const employeeRes = await db.query(
        `UPDATE employees SET is_locked = true, lock_until = $1 
         WHERE email = $2 RETURNING id`,
        [lockUntil, email]
      );

      if (employeeRes.rows.length === 0) {
        return res.status(404).json({ message: 'Employee not found' });
      }

      const employee = employeeRes.rows[0];

      // Invalidate active sessions
      await db.query(
        "UPDATE sessions SET status = 'invalidated' WHERE employee_id = $1",
        [employee.id]
      );

      console.log(`\n======================================================`);
      console.log(`[LOCK CALLBACK RECEIVED] Central locked account ${email}`);
      console.log(`======================================================\n`);

      return res.status(200).json({ message: 'Employee locked and sessions invalidated' });
    }
  } catch (error) {
    console.error('Lock/Unlock account callback error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Helper to extract cookies manually without cookie-parser
function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const parts = cookie.trim().split('=');
    const key = parts[0];
    const val = parts.slice(1).join('=');
    acc[key] = val;
    return acc;
  }, {});
  return cookies[name] || null;
}

// 4.5 Refresh Access Token Route (JWT + Cookie Rotation)
router.post('/refresh', async (req, res) => {
  const refreshToken = getCookie(req, 'refresh_token') || req.body.refreshToken;
  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required' });
  }

  try {
    const hashed = hashToken(refreshToken);
    const sessionRes = await db.query(
      `SELECT s.*, e.email FROM sessions s
       JOIN employees e ON s.employee_id = e.id
       WHERE s.refresh_token_hash = $1 AND s.status = 'active' AND s.refresh_expires_at > NOW()`,
      [hashed]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const session = sessionRes.rows[0];

    // Generate new Access Token
    const newSessionId = session.id;
    const newAccessToken = jwt.sign(
      { sessionId: newSessionId, employeeId: session.employee_id, email: session.email },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    const newTokenHash = hashToken(newAccessToken);

    // Rotate Refresh Token
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const newRefreshTokenHash = hashToken(newRefreshToken);
    const newRefreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const newAccessExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Update database
    await db.query(
      `UPDATE sessions 
       SET token_hash = $1, refresh_token_hash = $2, refresh_expires_at = $3, expires_at = $4
       WHERE id = $5`,
      [newTokenHash, newRefreshTokenHash, newRefreshExpiresAt, newAccessExpiresAt, session.id]
    );

    // Set new rotated refresh token in httpOnly cookie
    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: false, // set true in production
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: { id: session.employee_id, email: session.email },
    });
  } catch (error) {
    console.error('Session refresh error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// 5. Auth status validation route (GET /me)
router.get('/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const tokenHash = hashToken(token);

    // 1. Check if employee is locked
    const employeeQuery = await db.query('SELECT is_locked, lock_until FROM employees WHERE id = $1', [decoded.employeeId]);
    if (employeeQuery.rows.length > 0) {
      const employee = employeeQuery.rows[0];
      if (employee.is_locked) {
        const isExpired = employee.lock_until && new Date(employee.lock_until) <= new Date();
        if (!isExpired) {
          const remainingSeconds = employee.lock_until 
            ? Math.ceil((new Date(employee.lock_until) - new Date()) / 1000)
            : -1;
          return res.status(423).json({
            status: 'locked',
            message: remainingSeconds === -1 
              ? 'Account has been locked by an administrator.' 
              : 'Account is temporarily locked due to excessive failed attempts.',
            lockoutRemaining: remainingSeconds,
          });
        }
      }
    }

    // 2. Check session status
    const sessionRes = await db.query(
      'SELECT status, expires_at FROM sessions WHERE id = $1 AND token_hash = $2',
      [decoded.sessionId, tokenHash]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({ message: 'Session not found' });
    }

    const session = sessionRes.rows[0];

    if (session.status === 'invalidated' || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ message: 'Session expired or invalidated' });
    }

    if (session.status === 'mfa_pending') {
      return res.status(403).json({
        status: 'mfa_required',
        sessionId: decoded.sessionId,
        message: 'Secondary verification (OTP) required.',
      });
    }

    return res.status(200).json({
      user: {
        id: decoded.employeeId,
        email: decoded.email,
      },
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
});

// 6. Employee Logout Route
router.post('/logout', async (req, res) => {
  const authHeader = req.headers['authorization'];
  let sessionId = null;
  let email = null;
  let employeeId = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      sessionId = decoded.sessionId;
      email = decoded.email;
      employeeId = decoded.employeeId;
    } catch (err) {
      // Ignored: token might be expired, but we still invalidate by session or cookie
    }
  }

  try {
    if (sessionId) {
      // Invalidate session locally in client DB
      await db.query("UPDATE sessions SET status = 'invalidated' WHERE id = $1", [sessionId]);
    }

    // Invalidate refresh token if it exists in cookies/body
    const refreshToken = getCookie(req, 'refresh_token') || req.body.refreshToken;
    if (refreshToken) {
      const hashed = hashToken(refreshToken);
      await db.query("UPDATE sessions SET status = 'invalidated' WHERE refresh_token_hash = $1", [hashed]);
    }

    // Notify Central monitoring of the logout event
    if (email) {
      sendLoginEventWebhook({
        employeeId,
        email,
        eventType: 'logout',
        ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'] || 'Unknown',
        deviceFingerprint: req.body.deviceFingerprint,
      });
    }

    // Clear HTTP-only cookie
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: false, // set true in production
      sameSite: 'strict',
    });

    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout route error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
