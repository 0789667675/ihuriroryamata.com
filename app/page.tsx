// Milk System — Next.js + Supabase PostgreSQL migration
import WelcomePage from './welcome';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <WelcomePage copyrightYear={new Date().getFullYear()} />;
}
