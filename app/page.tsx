// Milk System — Next.js + Supabase PostgreSQL migration
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import WelcomePage from './welcome';
import { getAuthenticatedUserFromCookieStore } from '@/lib/security/authenticate';
import { init as initSessionInactivity } from '@/lib/session-inactivity';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
};

export default async function HomePage() {
  // Initialize the 48-hour inactivity session tracker
  initSessionInactivity({
    checkOnLoad: true,
    onExpire: async () => {
      // Perform any cleanup on session expiry
    }
  });

  const user = await getAuthenticatedUserFromCookieStore(cookies());
  if (user) {
    redirect('/dashboard');
  }
  return <WelcomePage copyrightYear={new Date().getFullYear()} />;
}
