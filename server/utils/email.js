const nodemailer = require('nodemailer');

let transporter;

function getMailConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || user;

  if (!host || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port,
    user,
    pass,
    from,
    secure: port === 465,
  };
}

function getTransporter() {
  const config = getMailConfig();
  if (!config) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  return { transporter, from: config.from };
}

async function sendEmail({ to, subject, html, text }) {
  try {
    const mail = getTransporter();
    if (!mail || !to) {
      if (!to) {
        console.log('Email skipped: no recipient configured');
      } else {
        console.log('Email skipped: SMTP environment variables are missing');
      }
      return false;
    }

    await mail.transporter.sendMail({
      from: mail.from,
      to,
      subject,
      text,
      html,
    });

    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
}

module.exports = { sendEmail };
