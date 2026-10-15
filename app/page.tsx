// Milk System — Next.js + Supabase PostgreSQL migration
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import WelcomePage from './welcome';
import { getAuthenticatedUserFromCookieStore } from '@/lib/security/authenticate';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
};

export default async function HomePage() {
  const user = await getAuthenticatedUserFromCookieStore(cookies());
  if (user) {
    redirect('/dashboard');
  }
  return <WelcomePage copyrightYear={new Date().getFullYear()} />;
}
