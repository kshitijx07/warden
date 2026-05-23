const crypto = require('crypto');
require('dotenv').config();

async function sendMfaChallengeCallback(company, sessionId) {
  const { callback_url, id: companyId } = company;
  const callbackToken = companyId === 'acme_corp' ? 'acme_secret_key' : 'globex_secret_key';

  console.log(`[CALLBACK ENGINE] Sending MFA challenge request to ${callback_url}/challenge-mfa`);

  try {
    const payload = {
      sessionId,
      companyId,
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', callbackToken).update(rawBody).digest('hex');

    const response = await fetch(`${callback_url}/challenge-mfa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': callbackToken,
        'X-Warden-Signature': signature,
      },
      body: rawBody,
    });

    if (!response.ok) {
      console.error(`MFA Callback failed with status: ${response.status}`);
    } else {
      console.log(`MFA Callback accepted by client portal for session: ${sessionId}`);
    }
  } catch (error) {
    console.error('Failed to execute MFA Callback to client:', error.message);
  }
}

async function sendLockAccountCallback(company, email) {
  const { callback_url, id: companyId } = company;
  const callbackToken = companyId === 'acme_corp' ? 'acme_secret_key' : 'globex_secret_key';

  console.log(`[CALLBACK ENGINE] Sending Lock Account request to ${callback_url}/lock-employee for ${email}`);

  try {
    const payload = {
      email,
      companyId,
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', callbackToken).update(rawBody).digest('hex');

    const response = await fetch(`${callback_url}/lock-employee`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': callbackToken,
        'X-Warden-Signature': signature,
      },
      body: rawBody,
    });

    if (!response.ok) {
      console.error(`Lock Callback failed with status: ${response.status}`);
    } else {
      console.log(`Lock Callback accepted by client portal for email: ${email}`);
    }
  } catch (error) {
    console.error('Failed to execute Lock Callback to client:', error.message);
  }
}

module.exports = {
  sendMfaChallengeCallback,
  sendLockAccountCallback,
};
