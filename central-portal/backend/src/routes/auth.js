const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const { logAdminAction } = require('../utils/auditLogger');
const { requireAuth } = require('../middleware/rbac');

const router = express.Router();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Admin Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const adminRes = await db.query('SELECT * FROM company_admins WHERE email = $1', [email]);
    if (adminRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const admin = adminRes.rows[0];

    // Check password
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        adminId: admin.id,
        email: admin.email,
        role: admin.role,
        companyId: admin.company_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // Generate Refresh Token
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Record session
    await db.query(
      `INSERT INTO admin_sessions (company_id, admin_id, token_hash, expires_at, refresh_token_hash, refresh_expires_at) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.company_id, admin.id, tokenHash, expiresAt, refreshTokenHash, refreshExpiresAt]
    );

    // Set cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: false, // set true in production
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Audit Log login event
    await logAdminAction({
      companyId: admin.company_id,
      adminId: admin.id,
      action: 'admin_login',
      targetType: 'company_admin',
      targetId: admin.id.toString(),
      metadata: { email: admin.email, role: admin.role },
    });

    return res.status(200).json({
      token,
      refreshToken, // Fallback
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        companyId: admin.company_id,
      },
    });
  } catch (error) {
    console.error('Admin login route error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin Logout
router.post('/logout', requireAuth, async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader.split(' ')[1];
  const tokenHash = hashToken(token);

  try {
    // Delete session from DB
    await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash]);

    // Audit Log logout event
    await logAdminAction({
      companyId: req.admin.companyId,
      adminId: req.admin.adminId,
      action: 'admin_logout',
      targetType: 'company_admin',
      targetId: req.admin.adminId.toString(),
      metadata: { email: req.admin.email },
    });

    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Admin logout route error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper to extract cookies manually
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

// Admin Session Refresh Route (Access token rotation)
router.post('/refresh', async (req, res) => {
  const refreshToken = getCookie(req, 'refresh_token') || req.body.refreshToken;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const hashed = hashToken(refreshToken);
    const sessionRes = await db.query(
      `SELECT s.*, a.email, a.role, a.company_id FROM admin_sessions s
       JOIN company_admins a ON s.admin_id = a.id
       WHERE s.refresh_token_hash = $1 AND s.refresh_expires_at > NOW()`,
      [hashed]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const session = sessionRes.rows[0];

    // Generate new Access Token (JWT)
    const newAccessToken = jwt.sign(
      {
        adminId: session.admin_id,
        email: session.email,
        role: session.role,
        companyId: session.company_id,
      },
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
      `UPDATE admin_sessions 
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
      admin: {
        id: session.admin_id,
        email: session.email,
        role: session.role,
        companyId: session.company_id,
      },
    });
  } catch (error) {
    console.error('Admin session refresh error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Validate session state route
router.get('/me', requireAuth, async (req, res) => {
  return res.status(200).json({ admin: req.admin });
});

module.exports = router;
