import { NextResponse } from 'next/server';

const { registerUser } = require('@/lib/services/auth-service.js');
const { sendRegistrationEmailVerification } = require('@/lib/services/account-service.js');
const emailService = require('@/lib/services/email-service.js');
const { repository } = require('@/lib/repositories/userRepository.js');
const { resolvePublicBaseUrl } = require('@/lib/config/public-url.js');

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const body = await request.json();
    const accountType = String(body.accountType || body.account_type || 'COLLECTOR').toUpperCase();
    const emailLanguage = body.language === 'en' ? 'en' : 'rw';
    const selectedPlanCode = body.selectedPlanCode || body.planCode || null;
    const user = await registerUser({
      repository,
      name: body.name,
      email: body.email,
      password: body.password,
      accountType,
      language: emailLanguage,
      selectedPlanCode,
    });
    const { passwordHash, ...publicUser } = user;
    const origin = resolvePublicBaseUrl({ request });
    const verificationPromise = origin
      ? sendRegistrationEmailVerification({
        userId: user.id,
        baseUrl: origin,
        language: emailLanguage,
        repository,
        mailer: emailService,
      }).catch((error) => ({ ok: false, error }))
      : Promise.resolve({ ok: false, error: { code: 'PUBLIC_APP_URL_NOT_CONFIGURED' } });
    const welcomePromise = origin
      ? emailService.sendWelcomeEmail({
        email: user.email,
        name: user.name,
        language: emailLanguage,
        loginUrl: `${origin}/login`,
      }).catch((error) => ({ ok: false, error }))
      : Promise.resolve({ ok: false, error: { code: 'PUBLIC_APP_URL_NOT_CONFIGURED' } });
    const [verificationResult, welcomeResult] = await Promise.all([verificationPromise, welcomePromise]);
    return NextResponse.json({
      ok: true,
      user: publicUser,
      verificationRequired: true,
      verificationEmailSent: verificationResult && verificationResult.ok !== false,
      welcomeEmailSent: welcomeResult && welcomeResult.ok !== false,
    }, { status: 201 });
  } catch (error) {
    const statusCode = error.statusCode || (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'SESSION_SECRET_NOT_CONFIGURED' || error.code === 'EMAIL_DELIVERY_UNAVAILABLE' ? 503 : 500);
    const isClientError = statusCode >= 400 && statusCode < 500;
    return NextResponse.json({
      ok: false,
      message: isClientError ? error.message : 'Unable to register account.',
      ...(isClientError && error.code ? { code: error.code } : {}),
    }, { status: statusCode });
  }
}
