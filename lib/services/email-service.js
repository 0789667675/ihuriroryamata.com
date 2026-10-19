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

const BRAND_NAME = "Ihuriro ry'Amata | Milk System";
const BRAND_BLUE = '#1681ab';
const TEXT_COLOR = '#20323b';
const MUTED_COLOR = '#637782';

const getProvider = () => {
  const configured = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (configured === 'resend') return 'resend';
  if (configured === 'smtp') return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  throw Object.assign(new Error('Email delivery is not configured. Set EMAIL_PROVIDER=resend with RESEND_API_KEY or configure SMTP explicitly.'), {
    code: 'EMAIL_NOT_CONFIGURED',
  });
};

const getSmtpTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !process.env.EMAIL_FROM) {
    const error = new Error('Email delivery is not configured.');
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

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
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

const renderBrandedEmail = ({ body, language = 'rw', preheader = '' }) => {
  const english = language === 'en';
  const origin = escapeHtml(getEmailOrigin());
  const brand = escapeHtml(BRAND_NAME);
  const footer = english
    ? 'This message was sent by Ihuriro ry\'Amata. Please do not reply to this automated email.'
    : 'Ubu butumwa bwoherejwe na Ihuriro ry\'Amata. Ntusubize ubu butumwa bwikora.';
  return `<!doctype html><html lang="${english ? 'en' : 'rw'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${brand}</title><style>@media (max-width:480px){.email-shell{padding:12px 8px!important}.email-body{padding:20px 16px!important}.email-button{display:block!important;width:100%!important;box-sizing:border-box!important}.email-title{font-size:20px!important}}</style></head><body style="margin:0;padding:0;background:#eef6f9;color:${TEXT_COLOR};font-family:Arial,Helvetica,sans-serif;line-height:1.55;-webkit-text-size-adjust:100%">${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef6f9"><tr><td class="email-shell" align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #cad9df;border-radius:10px;overflow:hidden"><tr><td style="padding:20px 24px;background:#eaf4f8;border-bottom:3px solid ${BRAND_BLUE}"><a href="${origin}" style="display:inline-flex;align-items:center;color:#105a78;text-decoration:none"><img src="${origin}/brand-logo-512.png" width="48" height="48" alt="${brand}" style="display:block;width:48px;height:48px;object-fit:contain"><span style="padding-left:12px;font-size:16px;font-weight:700;line-height:1.3">${brand}</span></a></td></tr><tr><td class="email-body" style="padding:26px 24px">${body}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #dce7eb;color:${MUTED_COLOR};font-size:12px;line-height:1.5">${escapeHtml(footer)}<br><a href="${origin}" style="color:${BRAND_BLUE};text-decoration:none">${origin}</a></td></tr></table></td></tr></table></body></html>`;
};

const renderEmailParagraph = (value, { strong = false } = {}) => `<p style="margin:0 0 14px;color:${TEXT_COLOR};font-size:15px;line-height:1.6;${strong ? 'font-weight:600;' : ''}">${escapeHtml(value)}</p>`;

const renderEmailDetails = (details = []) => details.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 18px;border-collapse:collapse">${details.map(({ label, value }) => `<tr><td style="padding:9px 12px 9px 0;border-bottom:1px solid #e3ecef;color:${MUTED_COLOR};font-size:13px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:9px 0;border-bottom:1px solid #e3ecef;color:${TEXT_COLOR};font-size:14px;font-weight:600;text-align:right;vertical-align:top;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table>` : '';

const renderEmailCode = (code) => code ? `<div style="margin:6px 0 18px;padding:16px 18px;background:#f2f8fa;border:1px solid #cad9df;border-radius:8px;text-align:center"><div style="color:${MUTED_COLOR};font-size:12px;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(code.label)}</div><div style="margin-top:6px;color:#105a78;font-size:28px;font-weight:700;letter-spacing:.24em">${escapeHtml(code.value)}</div></div>` : '';

const renderEmailButton = (action) => action ? `<p style="margin:20px 0 8px"><a class="email-button" href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;background:${BRAND_BLUE};color:#ffffff;font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:6px">${escapeHtml(action.label)}</a></p>` : '';

const renderEmailHtmlBody = ({ greeting, paragraphs = [], details = [], code = null, action = null, closing = [] }) => [
  greeting ? renderEmailParagraph(greeting, { strong: true }) : '',
  ...paragraphs.map((paragraph) => renderEmailParagraph(paragraph)),
  renderEmailCode(code),
  renderEmailDetails(details),
  renderEmailButton(action),
  ...closing.map((paragraph) => renderEmailParagraph(paragraph)),
].join('');

const renderPlainTextEmail = ({ greeting, paragraphs = [], details = [], code = null, action = null, closing = [] }) => {
  const lines = [];
  if (greeting) lines.push(greeting, '');
  if (paragraphs.length) lines.push(...paragraphs, '');
  if (code) lines.push(`${code.label}: ${code.value}`, '');
  if (details.length) {
    for (const { label, value } of details) lines.push(`${label}: ${value}`);
    lines.push('');
  }
  if (action) lines.push(`${action.label}: ${action.url}`, '');
  if (closing.length) lines.push(...closing);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * Shared email content builder. Every email gets the same branded, responsive
 * HTML shell and a readable plain-text fallback with the same facts and links.
 */
const renderEmailContent = ({ language = 'rw', greeting = '', paragraphs = [], details = [], code = null, action = null, closing = [], preheader = '' }) => {
  const content = { greeting, paragraphs, details, code, action, closing };
  return {
    text: renderPlainTextEmail(content),
    html: renderBrandedEmail({
      language,
      preheader: preheader || paragraphs[0] || '',
      body: renderEmailHtmlBody(content),
    }),
  };
};

const sendWelcomeEmail = async ({ email, name, language = 'rw', loginUrl = 'https://ihuriroryamata.com/login' }) => {
  const english = language === 'en';
  const displayName = String(name || email || '').trim();
  const greeting = english ? `Hello ${displayName},` : `Muraho ${displayName},`;
  const intro = english
    ? 'Your Milk System account is ready. Sign in to start managing farmers, milk collection, and reports.'
    : 'Konte yawe ya Milk System yiteguye. Injira ukomeze gucunga abahinzi, ibyakusanywa, n’ibipimo.';
  const content = renderEmailContent({
    language,
    greeting,
    paragraphs: [intro],
    action: { label: english ? 'Open Milk System' : 'Fungura Milk System', url: loginUrl },
  });
  return sendWithProvider({
    to: email,
    subject: english ? 'Welcome to Milk System' : 'Murakaza neza kuri Milk System',
    text: content.text,
    html: content.html,
  });
};

const sendPasswordResetCode = async ({ email, code, language = 'rw' }) => {
  const english = language === 'en';
  const content = renderEmailContent({
    language,
    paragraphs: english
      ? ['Use the code below to reset your Milk System password.', 'It expires in 10 minutes. If you did not request this, you can ignore this email.']
      : ['Koresha iyi kode gusubizaho ijambo ry’ibanga rya Milk System.', 'Irarangira nyuma y’iminota 10. Niba utabisabye, ushobora kwirengagiza ubu butumwa.'],
    code: { label: english ? 'Password reset code' : 'Kode yo gusubizaho ijambo ry’ibanga', value: String(code ?? '') },
  });
  await sendWithProvider({
    to: email,
    subject: english ? 'Milk System password reset code' : 'Kode yo gusubizaho ijambo ry’ibanga rya Milk System',
    text: content.text,
    html: content.html,
  });
};

const sendRegistrationEmailVerification = async ({ email, name, link, language = 'rw' }) => {
  const english = language === 'en';
  const displayName = String(name || email || '').trim();
  const greeting = english ? `Hello ${displayName},` : `Muraho ${displayName},`;
  const instruction = english
    ? 'Confirm your email address to activate sign-in for your Milk System account. This link expires in 24 hours.'
    : 'Emeza imeyili yawe kugira ngo ukoreshe konti ya Milk System. Iyi link irangira mu masaha 24.';
  const content = renderEmailContent({
    language,
    greeting,
    paragraphs: [instruction],
    action: { label: english ? 'Verify email address' : 'Emeza imeyili', url: link },
  });
  return sendWithProvider({
    to: email,
    subject: english ? 'Verify your Milk System email' : 'Emeza imeyili ya Milk System',
    text: content.text,
    html: content.html,
  });
};

const sendEmailChangeConfirmation = async ({ oldEmail, pendingEmail, name, link, language = 'rw' }) => {
  const english = language === 'en';
  const displayName = String(name || pendingEmail || '').trim();
  const greeting = english ? `Hello ${displayName},` : `Muraho ${displayName},`;
  const oldNotice = english
    ? `A request was made to change your Milk System email address to ${pendingEmail}. If you did not make this request, you can ignore this message.`
    : `Hasabwe guhindura imeyili ya konti ya Milk System yawe ikaba ${pendingEmail}. Niba atari wowe wabikoze, wirengagize ubu butumwa.`;
  const newInstruction = english
    ? 'Confirm this email change by opening the link below. It expires in 24 hours.'
    : 'Emeza iri hinduka ukanda kuri iyi link. Igihe cyayo kirangira mu masaha 24.';
  const oldContent = renderEmailContent({
    language,
    greeting,
    paragraphs: [oldNotice],
  });
  const newContent = renderEmailContent({
    language,
    greeting,
    paragraphs: [newInstruction],
    action: { label: english ? 'Confirm email address' : 'Emeza imeyili', url: link },
  });
  await Promise.all([
    sendWithProvider({
      to: oldEmail,
      subject: english ? 'Email change requested' : 'Wasabye guhindura imeyili ya konti',
      text: oldContent.text,
      html: oldContent.html,
    }),
    sendWithProvider({
      to: pendingEmail,
      subject: english ? 'Confirm your new Milk System email' : 'Emeza imeyili nshya ya Milk System',
      text: newContent.text,
      html: newContent.html,
    }),
  ]);
};

const sendPaymentConfirmation = async ({ to, payload = {} }) => {
  const english = payload.language === 'en';
  const billingPeriod = ({ monthly: english ? 'Monthly' : 'Ukwezi', '6_months': english ? '6 months' : 'Amezi 6', yearly: english ? 'Yearly' : 'Umwaka' })[payload.billingPeriod] || payload.billingPeriod || '';
  const customerName = String(payload.customerName || '').trim();
  const greeting = english ? `Hello${customerName ? ` ${customerName}` : ''},` : `Muraho${customerName ? ` ${customerName}` : ''},`;
  const details = [
    { label: english ? 'Amount' : 'Amafaranga', value: `${payload.amount ?? ''} ${payload.currency ?? ''}`.trim() },
    { label: english ? 'Billing period' : 'Igihe cyo kwishyura', value: billingPeriod },
    { label: english ? 'Plan' : 'Gahunda', value: payload.planName || '' },
    { label: english ? 'Payment date' : 'Itariki yo kwishyura', value: payload.paymentDate || '' },
    { label: english ? 'Reference' : 'Nomero y’icyifashishwa', value: payload.referenceId || '' },
    { label: english ? 'Transaction' : 'Nomero y’ubucuruzi', value: payload.transactionId || '' },
    { label: english ? 'Subscription starts' : 'Igihe gitangira', value: payload.subscriptionStart || '' },
    { label: english ? 'Subscription ends' : 'Igihe kirangira', value: payload.subscriptionEnd || '' },
  ];
  const content = renderEmailContent({
    language: payload.language,
    greeting,
    paragraphs: [english ? 'Your MTN MoMo subscription payment is confirmed.' : 'Ubwishyu bwawe bwa MTN MoMo bwemejwe.'],
    details,
  });
  return sendWithProvider({
    to,
    subject: english ? 'Milk System subscription payment confirmed' : 'Ubwishyu bwa konti ya Milk System bwemejwe',
    text: content.text,
    html: content.html,
  });
};

const sendSubscriptionReminder = async ({ to, payload = {} }) => {
  const english = payload.language === 'en';
  const customerName = String(payload.customerName || '').trim();
  const greeting = english ? `Hello${customerName ? ` ${customerName}` : ''},` : `Muraho${customerName ? ` ${customerName}` : ''},`;
  const planName = payload.planName || 'Milk System';
  const subscriptionEnd = payload.subscriptionEnd || '';
  const content = renderEmailContent({
    language: payload.language,
    greeting,
    paragraphs: [english
      ? `Your ${planName} subscription is due to end on ${subscriptionEnd}. Renew before that date to keep using Milk System.`
      : `Igihe cya gahunda yawe ${planName} kizarangira ku wa ${subscriptionEnd}. Vugurura mbere y’iyo tariki kugira ngo ukomeze gukoresha Milk System.`],
    action: { label: english ? 'Open Milk System' : 'Fungura Milk System', url: `${getEmailOrigin()}/login` },
  });
  return sendWithProvider({
    to,
    subject: english ? 'Milk System subscription renewal reminder' : 'Icyibutsa ivugururwa rya konti ya Milk System',
    text: content.text,
    html: content.html,
  });
};

const sendSubscriptionExpired = async ({ to, payload = {} }) => {
  const english = payload.language === 'en';
  const customerName = String(payload.customerName || '').trim();
  const greeting = english ? `Hello${customerName ? ` ${customerName}` : ''},` : `Muraho${customerName ? ` ${customerName}` : ''},`;
  const planName = payload.planName || 'Milk System';
  const subscriptionEnd = payload.subscriptionEnd || '';
  const pendingPaymentNote = payload.pendingPayment
    ? english
      ? 'A payment is still pending provider confirmation; check its status before starting another payment.'
      : 'Ubwishyu buracyategereje kwemezwa n’utanga serivisi; banza urebe uko buhagaze mbere yo gutangira ubundi.'
    : '';
  const content = renderEmailContent({
    language: payload.language,
    greeting,
    paragraphs: [
      english
        ? `Your ${planName} subscription ended on ${subscriptionEnd}.`
        : `Igihe cya gahunda yawe ${planName} cyarangiye ku wa ${subscriptionEnd}.`,
      ...(pendingPaymentNote ? [pendingPaymentNote] : []),
    ],
    action: { label: english ? 'Review renewal' : 'Reba ivugururwa', url: `${getEmailOrigin()}/login` },
  });
  return sendWithProvider({
    to,
    subject: english ? 'Milk System subscription expired' : 'Igihe cya konti ya Milk System cyarangiye',
    text: content.text,
    html: content.html,
  });
};

const sendSubscriptionUsageExceeded = async ({ to, payload = {} }) => {
  const english = payload.language === 'en';
  const actualLiters = Number(payload.actualLiters || 0).toLocaleString('en-US');
  const currentTier = payload.currentTier || { name: '—', range: '—' };
  const recommendedTier = payload.recommendedTier || { name: '—', range: '—', price: 0, currency: 'RWF' };
  const effectiveDate = payload.effectiveDate || (english ? 'next renewal' : 'ku ivugururwa ritaha');
  const price = `${recommendedTier.price ?? ''} ${recommendedTier.currency ?? ''}`.trim();
  const content = renderEmailContent({
    language: payload.language,
    paragraphs: english
      ? [
        `Your account recorded ${actualLiters} L during this period, above ${currentTier.name} (${currentTier.range}).`,
        `Suggested tier: ${recommendedTier.name} (${recommendedTier.range}) at ${price}/month. Effective date: ${effectiveDate}.`,
        'Your current paid tier remains active unless you explicitly accept a change.',
      ]
      : [
        `Konti yawe yanditse ${actualLiters} L muri iki gihe, birenze ${currentTier.name} (${currentTier.range}).`,
        `Icyiciro cyasabwa: ${recommendedTier.name} (${recommendedTier.range}) kuri ${price}/ukwezi. Itariki gitangiriraho: ${effectiveDate}.`,
        'Icyiciro wishyuye gikomeza gukora utaremera impinduka.',
      ],
    action: { label: english ? 'Review monthly selection' : 'Reba icyiciro cy’ukwezi', url: `${getEmailOrigin()}/login` },
  });
  return sendWithProvider({
    to,
    subject: english ? 'Milk System monthly volume tier exceeded' : 'Litiro zarenze icyiciro cya Milk System',
    text: content.text,
    html: content.html,
  });
};

module.exports = {
  getProvider,
  renderBrandedEmail,
  renderPlainTextEmail,
  renderEmailContent,
  sendWelcomeEmail,
  sendPasswordResetCode,
  sendRegistrationEmailVerification,
  sendEmailChangeConfirmation,
  sendPaymentConfirmation,
  sendSubscriptionReminder,
  sendSubscriptionExpired,
  sendSubscriptionUsageExceeded,
};
