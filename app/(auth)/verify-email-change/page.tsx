import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Workspace from '../../workspace';
import { getAuthenticatedUserFromCookieStore } from '@/lib/security/authenticate';

export default async function VerifyEmailChangePage() {
  const user = await getAuthenticatedUserFromCookieStore(cookies());
  if (user) {
    redirect('/dashboard');
  }
  return <Workspace />;
}
