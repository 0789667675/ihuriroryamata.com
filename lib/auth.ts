export const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'snemeyimana@gmail.com';

export function isSuperAdminEmail(email: string | null | undefined) {
  return Boolean(email && email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase());
}
