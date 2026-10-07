import { isSuperAdminEmail, normalizeAccountType, normalizeEmail, validatePassword } from '@/lib/validation/auth';

export { isSuperAdminEmail, normalizeAccountType, normalizeEmail, validatePassword };

export type AuthRole = 'user' | 'super_admin';
export type AccountType = 'COLLECTOR' | 'COLLECTION_CENTER';

export const resolveRole = (email: string | null | undefined, fallback: AuthRole = 'user') => {
  if (isSuperAdminEmail(email)) {
    return 'super_admin';
  }
  return fallback;
};
