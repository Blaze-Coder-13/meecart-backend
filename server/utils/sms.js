function buildMessage(template, vars) {
  return String(template || '')
    .replace(/\{code\}/g, String(vars.code ?? ''))
    .replace(/\{purpose\}/g, String(vars.purpose ?? ''));
}

function renderTemplateValue(str, vars, encode = true) {
  return String(str || '').replace(/\{(\w+)\}/g, (_m, key) => {
    const raw = vars[key] == null ? '' : String(vars[key]);
    return encode ? encodeURIComponent(raw) : raw;
  });
}

function getBulkSmsAppsTemplateId(purpose) {
  const p = String(purpose || '').toLowerCase();
  if (p === 'signup' && process.env.BULKSMSAPPS_TEMPLATE_ID_SIGNUP) return process.env.BULKSMSAPPS_TEMPLATE_ID_SIGNUP;
  if (p === 'forgot' && process.env.BULKSMSAPPS_TEMPLATE_ID_FORGOT) return process.env.BULKSMSAPPS_TEMPLATE_ID_FORGOT;
  return process.env.BULKSMSAPPS_TEMPLATE_ID || '';
}

function parseLikelyJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function looksLikeFailure(rawText, json) {
  const raw = String(rawText || '').trim();
  if (/^TRACE\s*:/i.test(raw)) return true;

  if (json && typeof json === 'object') {
    if (json.return === false) return true;
    if (typeof json.status === 'string') {
      const s = json.status.toLowerCase();
      if (s.includes('fail') || s.includes('error') || s.includes('reject')) return true;
    }
    if (json.error || json.errors) return true;
    if (typeof json.message === 'string') {
      const m = json.message.toLowerCase();
      if (m.includes('fail') || m.includes('error') || m.includes('invalid')) return true;
    }
  }

  const t = raw.toLowerCase();
  if (
    t.includes('error') ||
    t.includes('failed') ||
    t.includes('invalid') ||
    t.includes('insufficient') ||
    t.includes('unauthor') ||
    t.includes('empty message')
  ) return true;
  return false;
}

async function sendOtpViaFast2SMS(phone, code, purpose) {
  console.log(`\nOTP for ${phone} [${purpose}]: ${code}\n`);

  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    console.log('FAST2SMS_API_KEY not set - OTP only in logs');
    return { ok: true, skipped: true, provider: 'fast2sms' };
  }

  try {
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        variables_values: code,
        route: 'otp',
        numbers: phone,
        flash: '0',
      }).toString(),
    });

    const raw = await res.text();
    const data = parseLikelyJson(raw) ?? { raw };

    if (!res.ok || !data?.return) {
      const fast2smsError =
        data?.message?.join?.(', ') ||
        data?.message ||
        data?.error ||
        data?.raw ||
        'Unknown Fast2SMS error';
      console.log(`Fast2SMS failed for ${phone}: ${fast2smsError}`);
      return { ok: false, error: fast2smsError, status: res.status, provider: 'fast2sms' };
    }

    console.log(`SMS sent to ${phone}`);
    return { ok: true, data, provider: 'fast2sms' };
  } catch (err) {
    console.error('SMS error:', err);
    return { ok: false, error: err.message || 'SMS request failed', provider: 'fast2sms' };
  }
}

async function sendOtpViaBulkSMSApps(phone, code, purpose) {
  console.log(`\nOTP for ${phone} [${purpose}]: ${code}\n`);

  const apiKey = process.env.BULKSMSAPPS_API_KEY;
  const urlTemplate = process.env.BULKSMSAPPS_URL_TEMPLATE;

  if (!apiKey || !urlTemplate) {
    console.log('BULKSMSAPPS_API_KEY / BULKSMSAPPS_URL_TEMPLATE not set - OTP only in logs');
    return { ok: true, skipped: true, provider: 'bulksmsapps' };
  }

  const templateId = getBulkSmsAppsTemplateId(purpose);
  const senderId = process.env.BULKSMSAPPS_SENDER_ID || '';
  const entityId = process.env.BULKSMSAPPS_ENTITY_ID || '';
  const messageTemplate = process.env.BULKSMSAPPS_MESSAGE_TEMPLATE || 'Your OTP is {code}.';
  const message = buildMessage(messageTemplate, { code, purpose });

  const vars = {
    apiKey,
    phone,
    code,
    purpose,
    message,
    senderId,
    entityId,
    templateId,
  };

  const method = String(process.env.BULKSMSAPPS_METHOD || 'GET').trim().toUpperCase();
  const [baseTemplate, queryTemplate = ''] = String(urlTemplate).split('?');
  const urlBase = renderTemplateValue(baseTemplate, vars, true);

  let url = urlBase;
  let body;
  let headers;

  if (method === 'POST') {
    const params = new URLSearchParams();
    if (queryTemplate) {
      for (const part of queryTemplate.split('&')) {
        if (!part) continue;
        const [k, v = ''] = part.split('=');
        if (!k) continue;
        params.set(k, renderTemplateValue(v, vars, false));
      }
    }
    body = params.toString();
    headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  } else {
    if (queryTemplate) {
      const pairs = [];
      for (const part of queryTemplate.split('&')) {
        if (!part) continue;
        const [k, v = ''] = part.split('=');
        if (!k) continue;
        pairs.push(`${encodeURIComponent(k)}=${renderTemplateValue(v, vars, true)}`);
      }
      url = `${urlBase}?${pairs.join('&')}`;
    }
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.BULKSMSAPPS_TIMEOUT_MS || 10000);
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 10000);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    const raw = await res.text();
    const json = parseLikelyJson(raw);

    if (!res.ok || looksLikeFailure(raw, json)) {
      const safeSnippet = raw ? raw.slice(0, 400) : '';
      console.log(`BulkSMSApps failed for ${phone}: ${safeSnippet}`);
      return {
        ok: false,
        error: safeSnippet || `HTTP ${res.status}`,
        status: res.status,
        provider: 'bulksmsapps',
        data: json ?? undefined,
      };
    }

    console.log(`SMS sent to ${phone} via BulkSMSApps`);
    return { ok: true, provider: 'bulksmsapps', data: json ?? { raw } };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'SMS request timed out' : (err?.message || 'SMS request failed');
    console.error('SMS error:', err);
    return { ok: false, error: msg, provider: 'bulksmsapps' };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendOtpSms(phone, code, purpose) {
  const preferred = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();

  if (preferred === 'bulksmsapps') return sendOtpViaBulkSMSApps(phone, code, purpose);
  if (preferred === 'fast2sms') return sendOtpViaFast2SMS(phone, code, purpose);
  if (preferred === 'log') {
    console.log(`\nOTP for ${phone} [${purpose}]: ${code}\n`);
    return { ok: true, skipped: true, provider: 'log' };
  }

  if (process.env.BULKSMSAPPS_API_KEY && process.env.BULKSMSAPPS_URL_TEMPLATE) {
    return sendOtpViaBulkSMSApps(phone, code, purpose);
  }
  if (process.env.FAST2SMS_API_KEY) {
    return sendOtpViaFast2SMS(phone, code, purpose);
  }

  console.log(`\nOTP for ${phone} [${purpose}]: ${code}\n`);
  return { ok: true, skipped: true, provider: 'log' };
}

module.exports = {
  sendOtpSms,
  sendOtpViaBulkSMSApps,
  sendOtpViaFast2SMS,
};
