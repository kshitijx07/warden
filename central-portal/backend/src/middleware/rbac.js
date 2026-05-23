const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded; // Contains: adminId, email, role, companyId
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasRole = Array.isArray(roles) ? roles.includes(req.admin.role) : req.admin.role === roles;
    if (!hasRole) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }

    next();
  };
}

// Strictly enforces tenant isolation at the API layer for Company Admins
function restrictToTenant(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.admin.role === 'superadmin') {
    // Super Admin is allowed to bypass restrictions
    req.tenantId = req.params.companyId || req.query.companyId || req.body.companyId || null;
    return next();
  }

  // Company Admin checks
  const targetCompanyId = req.params.companyId || req.query.companyId || req.body.companyId;

  if (targetCompanyId && targetCompanyId !== req.admin.companyId) {
    return res.status(403).json({ error: 'Forbidden: Cross-tenant data access is strictly prohibited.' });
  }

  // Force bind company ID to the request object
  req.tenantId = req.admin.companyId;
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  restrictToTenant,
};
