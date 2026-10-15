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

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const getEmailOrigin = () => {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return url.origin;
    } catch {}
  }
  return 'https://ihuriroryamata.com';
};

const renderBrandedEmail = ({ body, language = 'rw' }) => {
  const english = language === 'en';
  const origin = escapeHtml(getEmailOrigin());
  const brand = "Ihuriro ry'Amata | Milk System";
  return `<!doctype html><html lang="${english ? 'en' : 'rw'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#eef6f9;color:#20323b;font-family:Arial,Helvetica,sans-serif;line-height:1.55"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6f9;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #cad9df;border-radius:8px;overflow:hidden"><tr><td style="padding:22px 24px;background:#eaf4f8;border-bottom:3px solid #1681ab"><a href="${origin}" style="display:inline-flex;align-items:center;color:#105a78;text-decoration:none"><img src="${origin}/brand-logo-512.png" width="52" height="52" alt="${escapeHtml(brand)}" style="display:block;width:52px;height:52px;object-fit:contain"><span style="padding-left:12px;font-size:16px;font-weight:700">${escapeHtml(brand)}</span></a></td></tr><tr><td style="padding:26px 24px">${body}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #dce7eb;color:#637782;font-size:12px">${escapeHtml(brand)}</td></tr></table></td></tr></table></body></html>`;
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
    html: renderBrandedEmail({ language, body: `<p>${escapeHtml(copy.intro)}</p><p>${escapeHtml(copy.expiry)}</p>` }),
  });
};

const sendRegistrationEmailVerification = async ({ email, name, link, language = 'rw' }) => {
  const safeName = escapeHtml(name || email);
  const safeLink = escapeHtml(link);
  const english = language === 'en';
  const subject = english ? 'Verify your Milk System email' : 'Emeza imeyili ya Milk System';
  const greeting = english ? `Hello ${safeName},` : `Muraho ${safeName},`;
  const instruction = english
    ? 'Confirm your email address to activate sign-in for your Milk System account. This link expires in 24 hours.'
    : 'Emeza imeyili yawe kugira ngo ukoreshe konti ya Milk System. Iyi link irangira mu masaha 24.';
  const action = english ? 'Verify email address' : 'Emeza imeyili';
  return sendWithProvider({
    to: email,
    subject,
    text: `${greeting}\n\n${instruction}\n\n${link}`,
    html: renderBrandedEmail({ language, body: `<p>${greeting}</p><p>${instruction}</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#1681ab;color:#ffffff;text-decoration:none;border-radius:6px">${action}</a></p>` }),
  });
};

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
      html: renderBrandedEmail({ language, body: `<p>${oldCopy.body}</p>` }),
    }),
    sendWithProvider({
      to: pendingEmail,
      subject: newCopy.subject,
      text: `${newCopy.body}\n\n${link}`,
      html: renderBrandedEmail({ language, body: `<p>${newCopy.body}</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#1681ab;color:#ffffff;text-decoration:none;border-radius:6px">${english ? 'Confirm email address' : 'Emeza imeyili'}</a></p>` }),
    }),
  ]);
};

const sendPaymentConfirmation = async ({ to, payload }) => {
  const english = payload.language === 'en';
  const billingPeriod = ({ monthly: english ? 'Monthly' : 'Ukwezi', '6_months': english ? '6 months' : 'Amezi 6', yearly: english ? 'Yearly' : 'Umwaka' })[payload.billingPeriod] || payload.billingPeriod;
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
  const subject = english ? 'Milk System subscription payment confirmed' : 'Ubwishyu bwa konti ya Milk System bwemejwe';
  const greeting = english ? `Hello ${payload.customerName},` : `Muraho ${payload.customerName},`;
  const confirmation = english ? 'Your MTN MoMo subscription payment is confirmed.' : 'Ubwishyu bwawe bwa MTN MoMo bwemejwe.';
  const labels = english
    ? ['Amount', 'Billing period', 'Plan', 'Payment date', 'Reference', 'Transaction', 'Subscription starts', 'Subscription ends']
    : ['Amafaranga', 'Igihe cyo kwishyura', 'Gahunda', 'Itariki yo kwishyura', 'Nomero y’icyifashishwa', 'Nomero y’ubucuruzi', 'Igihe gitangira', 'Igihe kirangira'];
  const text = [
    greeting,
    confirmation,
    `${labels[0]}: ${payload.amount} ${payload.currency}`,
    `${labels[1]}: ${billingPeriod}`,
    `${labels[2]}: ${payload.planName}`,
    `${labels[3]}: ${payload.paymentDate}`,
    `${labels[4]}: ${payload.referenceId}`,
    `${labels[5]}: ${payload.transactionId}`,
    `${labels[6]}: ${payload.subscriptionStart}`,
    `${labels[7]}: ${payload.subscriptionEnd}`,
  ].join('\n');
  const values = [safe.amount, safe.billingPeriod, safe.planName, safe.paymentDate, safe.referenceId, safe.transactionId, safe.subscriptionStart, safe.subscriptionEnd];
  const html = renderBrandedEmail({ language: payload.language, body: `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(confirmation)}</p><dl>${labels.map((label, index) => `<dt style="color:#637782;font-size:13px">${label}</dt><dd style="margin:0 0 12px;font-weight:600">${values[index]}</dd>`).join('')}</dl>` });
  return sendWithProvider({ to, subject, text, html });
};

const sendSubscriptionReminder = async ({ to, payload }) => {
  const english = payload.language === 'en';
  const name = escapeHtml(payload.customerName);
  const endDate = escapeHtml(payload.subscriptionEnd);
  const planName = escapeHtml(payload.planName);
  const subject = english ? 'Milk System subscription renewal reminder' : 'Icyibutsa ivugururwa rya konti ya Milk System';
  const text = english
    ? `Hello ${payload.customerName}, your ${payload.planName} subscription is due to end on ${payload.subscriptionEnd}. Open Milk System to review your subscription.`
    : `Muraho ${payload.customerName}, igihe cya gahunda yawe ${payload.planName} kizarangira ku wa ${payload.subscriptionEnd}. Fungura Milk System urebe amakuru yo kwishyura.`;
  const html = renderBrandedEmail({ language: payload.language, body: english
    ? `<p>Hello ${name},</p><p>Your ${planName} subscription is due to end on <strong>${endDate}</strong>.</p><p>Open Milk System to review your subscription.</p>`
    : `<p>Muraho ${name},</p><p>Igihe cya gahunda yawe ${planName} kizarangira ku wa <strong>${endDate}</strong>.</p><p>Fungura Milk System urebe amakuru yo kwishyura.</p>` });
  return sendWithProvider({ to, subject, text, html });
};

const sendSubscriptionExpired = async ({ to, payload }) => {
  const english = payload.language === 'en';
  const name = escapeHtml(payload.customerName);
  const endDate = escapeHtml(payload.subscriptionEnd);
  const planName = escapeHtml(payload.planName);
  const pendingPaymentNote = payload.pendingPayment
    ? english ? ' A payment is still pending provider confirmation; check its status before starting another payment.' : ' Ubwishyu buracyategereje kwemezwa n’utanga serivisi; banza urebe uko buhagaze mbere yo gutangira ubundi.'
    : '';
  const subject = english ? 'Milk System subscription expired' : 'Igihe cya konti ya Milk System cyarangiye';
  const text = english
    ? `Hello ${payload.customerName}, your ${payload.planName} subscription ended on ${payload.subscriptionEnd}.${pendingPaymentNote} Open Milk System to review renewal.`
    : `Muraho ${payload.customerName}, igihe cya gahunda yawe ${payload.planName} cyarangiye ku wa ${payload.subscriptionEnd}.${pendingPaymentNote} Fungura Milk System urebe uko wavugurura konti.`;
  const html = renderBrandedEmail({ language: payload.language, body: english
    ? `<p>Hello ${name},</p><p>Your ${planName} subscription ended on <strong>${endDate}</strong>.</p>${payload.pendingPayment ? '<p>A payment is still pending provider confirmation. Check its status before starting another payment.</p>' : ''}<p>Open Milk System to review renewal.</p>`
    : `<p>Muraho ${name},</p><p>Igihe cya gahunda yawe ${planName} cyarangiye ku wa <strong>${endDate}</strong>.</p>${payload.pendingPayment ? `<p>${escapeHtml(pendingPaymentNote.trim())}</p>` : ''}<p>Fungura Milk System urebe uko wavugurura konti.</p>` });
  return sendWithProvider({ to, subject, text, html });
};

const sendSubscriptionUsageExceeded = async ({ to, payload }) => {
  const english = payload.language === 'en';
  const safe = {
    actualLiters: escapeHtml(payload.actualLiters),
    currentName: escapeHtml(payload.currentTier.name),
    currentRange: escapeHtml(payload.currentTier.range),
    nextName: escapeHtml(payload.recommendedTier.name),
    nextRange: escapeHtml(payload.recommendedTier.range),
    nextPrice: escapeHtml(`${payload.recommendedTier.price} ${payload.recommendedTier.currency}`),
    effectiveDate: escapeHtml(payload.effectiveDate || (english ? 'next renewal' : 'ku ivugururwa ritaha')),
  };
  const subject = english ? 'Milk System monthly volume tier exceeded' : 'Litiro zarenze icyiciro cya Milk System';
  const text = english
    ? `Your account recorded ${payload.actualLiters} L during this period, above ${payload.currentTier.name} (${payload.currentTier.range}). Suggested tier: ${payload.recommendedTier.name} (${payload.recommendedTier.range}) at ${payload.recommendedTier.price} ${payload.recommendedTier.currency}/month. Effective date: ${payload.effectiveDate || 'next renewal'}. Your current paid tier remains active unless you explicitly accept a change.`
    : `Konti yawe yanditse ${payload.actualLiters} L muri iki gihe, birenze ${payload.currentTier.name} (${payload.currentTier.range}). Icyiciro cyasabwa: ${payload.recommendedTier.name} (${payload.recommendedTier.range}) kuri ${payload.recommendedTier.price} ${payload.recommendedTier.currency}/ukwezi. Itariki gitangiriraho: ${payload.effectiveDate || 'ku ivugururwa ritaha'}. Icyiciro wishyuye gikomeza gukora utaremera impinduka.`;
  const body = english
    ? `<p>Your account recorded <strong>${safe.actualLiters} L</strong> during this period, above ${safe.currentName} (${safe.currentRange}).</p><p>Suggested tier: <strong>${safe.nextName}</strong> (${safe.nextRange}) at <strong>${safe.nextPrice}/month</strong>.</p><p>Effective date: ${safe.effectiveDate}. Your current paid tier remains active unless you explicitly accept a change.</p><p>Open IHURIRO RY'AMATA | Milk System to review your monthly selection.</p>`
    : `<p>Konti yawe yanditse <strong>${safe.actualLiters} L</strong> muri iki gihe, birenze ${safe.currentName} (${safe.currentRange}).</p><p>Icyiciro cyasabwa: <strong>${safe.nextName}</strong> (${safe.nextRange}) kuri <strong>${safe.nextPrice}/ukwezi</strong>.</p><p>Itariki gitangiriraho: ${safe.effectiveDate}. Icyiciro wishyuye gikomeza gukora utaremera impinduka.</p><p>Fungura IHURIRO RY'AMATA | Milk System urebe icyiciro cy'ukwezi.</p>`;
  const html = renderBrandedEmail({ language: payload.language, body });
  return sendWithProvider({ to, subject, text, html });
};

module.exports = { getProvider, renderBrandedEmail, sendPasswordResetCode, sendRegistrationEmailVerification, sendEmailChangeConfirmation, sendPaymentConfirmation, sendSubscriptionReminder, sendSubscriptionExpired, sendSubscriptionUsageExceeded };