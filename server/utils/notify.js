const { query } = require('../db');

async function sendPushToUser(userId, title, body) {
  try {
    const result = await query('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
    const tokens = result.rows.map(r => r.token);

    if (tokens.length === 0) return;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
      }))),
    });
  } catch (err) {
    console.error('Push notification error:', err);
  }
}

async function sendPushToAdmins(title, body) {
  try {
    const result = await query(`
      SELECT pt.token FROM push_tokens pt
      JOIN users u ON pt.user_id = u.id
      WHERE u.role = 'admin'
    `);
    const tokens = result.rows.map(r => r.token);

    if (tokens.length === 0) return;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
      }))),
    });
  } catch (err) {
    console.error('Push notification error:', err);
  }
}

module.exports = { sendPushToUser, sendPushToAdmins };