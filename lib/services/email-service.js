let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

let ResendClient = null;
try {
  const ResendModule = require('resend');
  ResendClient = ResendModule.Resend || ResendModule.default || ResendModule;
} catch {
  ResendClient = null;
}

let transporter;

const getProvider = () => {
  const configured = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (configured === 'resend') return 'resend';
  if (configured === 'smtp') return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  throw new Error('Email delivery is not configured. Set EMAIL_PROVIDER=resend with RESEND_API_KEY or configure SMTP explicitly.');
};

const getSmtpTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !process.env.EMAIL_FROM) {
    const error = new Error('Password reset email delivery is not configured.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  if (!nodemailer) {
    const error = new Error('SMTP email delivery is not available. Install nodemailer or switch EMAIL_PROVIDER to resend.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  if (!transporter) {
    const port = Number(SMTP_PORT);
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      logger: false,
      debug: false,
    });
  }
  return transporter;
};

const getResendClient = () => {
  if (!process.env.RESEND_API_KEY || !ResendClient || !(process.env.RESEND_FROM || process.env.EMAIL_FROM)) {
    const error = new Error('Resend email delivery is not configured.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  return new ResendClient(process.env.RESEND_API_KEY);
};

const sendWithProvider = async ({ to, subject, text, html }) => {
  const provider = getProvider();
  if (provider === 'resend') {
    const client = getResendClient();
    const result = await client.emails.send({
      from: process.env.RESEND_FROM || process.env.EMAIL_FROM,
      to: [to],
      subject,
      text,
      html,
    });
    if (result && result.error) {
      const error = new Error(result.error.message || 'Resend rejected the email request.');
      error.code = 'EMAIL_PROVIDER_REJECTED';
      throw error;
    }
    return result;
  }

  await getSmtpTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
};

const sendPasswordResetCode = async ({ email, code, language = 'rw' }) => {
  const copy = language === 'en'
    ? {
      subject: 'Milk System password reset code',
      intro: `Your Milk System password reset code is ${code}.`,
      expiry: 'It expires in 10 minutes. If you did not request this, you can ignore this email.',
    }
    : {
      subject: 'Kode yo gusubizaho ijambo ry’ibanga rya Milk System',
      intro: `Kode yawe yo gusubizaho ijambo ry’ibanga ni ${code}.`,
      expiry: 'Irarangira nyuma y’iminota 10. Niba utabisabye, ushobora kwirengagiza ubu butumwa.',
    };
  await sendWithProvider({
    to: email,
    subject: copy.subject,
    text: `${copy.intro} ${copy.expiry}`,
    html: `<p>${copy.intro}</p><p>${copy.expiry}</p>`,
  });
};

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const sendEmailChangeConfirmation = async ({ oldEmail, pendingEmail, name, link, language = 'rw' }) => {
  const safeName = escapeHtml(name || pendingEmail);
  const safeLink = escapeHtml(link);
  const english = language === 'en';
  const oldCopy = english
    ? { subject: 'Email change requested', body: `A request was made to change your Milk System email address to ${escapeHtml(pendingEmail)}. If you did not make this request, you can ignore this message.` }
    : { subject: 'Wasabye guhindura imeyili ya konti', body: `Hasabwe guhindura imeyili ya konti ya Milk System yawe ikaba ${escapeHtml(pendingEmail)}. Niba atari wowe wabikoze, wirengagize ubu butumwa.` };
  const newCopy = english
    ? { subject: 'Confirm your new Milk System email', body: `Hello ${safeName}, confirm this email change by opening the link below. It expires in 24 hours.` }
    : { subject: 'Emeza imeyili nshya ya Milk System', body: `Muraho ${safeName}, emeza iri hinduka ukanda kuri iyi link. Igihe cyayo kirangira mu masaha 24.` };
  await Promise.all([
    sendWithProvider({
      to: oldEmail,
      subject: oldCopy.subject,
      text: oldCopy.body,
      html: `<p>${oldCopy.body}</p>`,
    }),
    sendWithProvider({
      to: pendingEmail,
      subject: newCopy.subject,
      text: `${newCopy.body}\n\n${link}`,
      html: `<p>${newCopy.body}</p><p><a href="${safeLink}">${english ? 'Confirm email address' : 'Emeza imeyili'}</a></p>`,
    }),
  ]);
};

const sendPaymentConfirmation = async ({ to, payload }) => {
  const billingPeriod = ({ monthly: 'Monthly', '6_months': '6 months', yearly: 'Yearly' })[payload.billingPeriod] || payload.billingPeriod;
  const safe = {
    customerName: escapeHtml(payload.customerName),
    amount: escapeHtml(`${payload.amount} ${payload.currency}`),
    billingPeriod: escapeHtml(billingPeriod),
    planName: escapeHtml(payload.planName),
    paymentDate: escapeHtml(payload.paymentDate),
    referenceId: escapeHtml(payload.referenceId),
    transactionId: escapeHtml(payload.transactionId),
    subscriptionStart: escapeHtml(payload.subscriptionStart),
    subscriptionEnd: escapeHtml(payload.subscriptionEnd),
  };
  const subject = 'Milk System subscription payment confirmed';
  const text = [
    `Hello ${payload.customerName},`,
    'Your MTN MoMo subscription payment is confirmed.',
    `Amount: ${payload.amount} ${payload.currency}`,
    `Billing period: ${billingPeriod}`,
    `Plan: ${payload.planName}`,
    `Payment date: ${payload.paymentDate}`,
    `Reference: ${payload.referenceId}`,
    `Transaction: ${payload.transactionId}`,
    `Subscription starts: ${payload.subscriptionStart}`,
    `Subscription ends: ${payload.subscriptionEnd}`,
  ].join('\n');
  const html = `<p>Hello ${safe.customerName},</p><p>Your MTN MoMo subscription payment is confirmed.</p><dl><dt>Amount</dt><dd>${safe.amount}</dd><dt>Billing period</dt><dd>${safe.billingPeriod}</dd><dt>Plan</dt><dd>${safe.planName}</dd><dt>Payment date</dt><dd>${safe.paymentDate}</dd><dt>Reference</dt><dd>${safe.referenceId}</dd><dt>Transaction</dt><dd>${safe.transactionId}</dd><dt>Subscription starts</dt><dd>${safe.subscriptionStart}</dd><dt>Subscription ends</dt><dd>${safe.subscriptionEnd}</dd></dl><p>IHURIRO RY'AMATA | Milk System</p>`;
  return sendWithProvider({ to, subject, text, html });
};

const sendSubscriptionReminder = async ({ to, payload }) => {
  const name = escapeHtml(payload.customerName);
  const endDate = escapeHtml(payload.subscriptionEnd);
  const planName = escapeHtml(payload.planName);
  const subject = 'Milk System subscription renewal reminder';
  const text = `Hello ${payload.customerName}, your ${payload.planName} subscription is due to end on ${payload.subscriptionEnd}. Open Milk System to review your subscription.`;
  const html = `<p>Hello ${name},</p><p>Your ${planName} subscription is due to end on <strong>${endDate}</strong>.</p><p>Open Milk System to review your subscription.</p><p>IHURIRO RY'AMATA | Milk System</p>`;
  return sendWithProvider({ to, subject, text, html });
};

const sendSubscriptionExpired = async ({ to, payload }) => {
  const name = escapeHtml(payload.customerName);
  const endDate = escapeHtml(payload.subscriptionEnd);
  const planName = escapeHtml(payload.planName);
  const pendingPaymentNote = payload.pendingPayment
    ? ' A payment is still pending provider confirmation; check its status before starting another payment.'
    : '';
  const subject = 'Milk System subscription expired';
  const text = `Hello ${payload.customerName}, your ${payload.planName} subscription ended on ${payload.subscriptionEnd}.${pendingPaymentNote} Open Milk System to review renewal.`;
  const html = `<p>Hello ${name},</p><p>Your ${planName} subscription ended on <strong>${endDate}</strong>.</p>${payload.pendingPayment ? '<p>A payment is still pending provider confirmation. Check its status before starting another payment.</p>' : ''}<p>Open Milk System to review renewal.</p><p>IHURIRO RY'AMATA | Milk System</p>`;
  return sendWithProvider({ to, subject, text, html });
};

module.exports = { getProvider, sendPasswordResetCode, sendEmailChangeConfirmation, sendPaymentConfirmation, sendSubscriptionReminder, sendSubscriptionExpired };