const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { processTelemetryEvent } = require('../services/ingestionService');

const router = express.Router();

// Webhook Ingestion API (Push Model)
router.post('/ingest', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'API key missing in headers' });
  }

  const { companyId, email } = req.body;

  if (!companyId || !email) {
    return res.status(400).json({ error: 'companyId and email are required fields' });
  }

  try {
    // 1. Verify Company & API Key
    const companyRes = await db.query('SELECT * FROM companies WHERE id = $1', [companyId]);
    if (companyRes.rows.length === 0) {
      return res.status(404).json({ error: 'Company registration not found' });
    }
    const company = companyRes.rows[0];

    // Verify key hash
    const keyMatch = await bcrypt.compare(apiKey, company.api_key_hash);
    if (!keyMatch) {
      return res.status(401).json({ error: 'Invalid API Key credentials' });
    }

    // 2. Process event via shared ingestion service
    const result = await processTelemetryEvent(company, req.body);

    return res.status(200).json({
      success: true,
      message: 'Telemetry ingestion completed successfully',
      riskScore: result.riskScore,
      actionTaken: result.actionTaken,
    });

  } catch (error) {
    console.error('Central ingestion route error:', error);
    return res.status(500).json({ error: 'Internal Ingestion server error' });
  }
});

module.exports = router;
