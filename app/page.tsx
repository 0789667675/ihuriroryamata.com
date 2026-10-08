// Milk System — Next.js + Supabase PostgreSQL migration
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import WelcomePage from './welcome';
import { getAuthenticatedUserFromCookieStore } from '@/lib/security/authenticate';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getAuthenticatedUserFromCookieStore(cookies());
  if (user) {
    redirect('/dashboard');
  }
  return <WelcomePage copyrightYear={new Date().getFullYear()} />;
}
