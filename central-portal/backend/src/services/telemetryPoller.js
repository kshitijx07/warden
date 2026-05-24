const db = require('../config/db');
const crypto = require('crypto');
const { processTelemetryEvent } = require('./ingestionService');

let pollingInterval = null;

async function pollTelemetryForCompany(company) {
  if (!company.callback_url) return;

  const url = `${company.callback_url}/telemetry?lastId=${company.last_telemetry_id || 0}`;

  try {
    const callbackToken = company.id === 'acme_corp' ? 'acme_secret_key' : 'globex_secret_key';
    const timestamp = new Date().toISOString();
    const payloadStr = JSON.stringify({
      companyId: company.id,
      timestamp,
    });

    const signature = crypto
      .createHmac('sha256', callbackToken)
      .update(payloadStr)
      .digest('hex');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': callbackToken,
        'x-warden-signature': signature,
        'x-warden-payload': payloadStr,
      },
    });

    if (!response.ok) {
      return;
    }

    const { events } = await response.json();
    if (!events || events.length === 0) return;

    console.log(`[POLLER] Fetched ${events.length} new events for ${company.id}`);

    let maxId = company.last_telemetry_id || 0;

    for (const event of events) {
      try {
        console.log(`[POLLER] Processing event: ${event.eventType} for ${event.email}`);
        await processTelemetryEvent(company, event);
      } catch (err) {
        console.error(`[POLLER ERROR] Processing event ${event.id}:`, err.message);
      }
      if (event.id > maxId) {
        maxId = event.id;
      }
    }

    await db.query(
      'UPDATE companies SET last_telemetry_id = $1 WHERE id = $2',
      [maxId, company.id]
    );

  } catch (err) {
    if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
      // Client Portal is down, ignore
    } else {
      console.error(`[POLLER ERROR] Failed to poll company ${company.id}:`, err.message);
    }
  }
}

async function runPollingCycle() {
  try {
    const res = await db.query('SELECT * FROM companies');
    for (const company of res.rows) {
      await pollTelemetryForCompany(company);
    }
  } catch (err) {
    console.error('[POLLER ERROR] Database error in polling cycle:', err.message);
  }
}

function startPolling(intervalMs = 3000) {
  if (pollingInterval) return;
  console.log(`[POLLER] Starting telemetry poller background service (interval: ${intervalMs}ms)...`);
  pollingInterval = setInterval(runPollingCycle, intervalMs);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

module.exports = {
  startPolling,
  stopPolling,
};
