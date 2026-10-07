export const validatePassword = (password: string | undefined | null) => {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  return null;
};

export const normalizeEmail = (email: string | undefined | null) => String(email ?? '').trim().toLowerCase();

export const normalizeAccountType = (value: string | undefined | null) => {
  const raw = String(value ?? 'COLLECTOR').trim().toUpperCase();
  return raw === 'COLLECTION_CENTER' ? 'COLLECTION_CENTER' : 'COLLECTOR';
};

export const isSuperAdminEmail = (email: string | null | undefined, authorityEmail = 'snemeyimana@gmail.com') =>
  Boolean(email && email.trim().toLowerCase() === authorityEmail.trim().toLowerCase());
