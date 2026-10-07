import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: "IHURIRO RY'AMATA | Milk System",
  description: 'Manage farmers, collection centers, daily milk collection, reports, deductions, notifications, and subscriptions with Milk System.',
  applicationName: 'Milk System',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/brand-logo.png', type: 'image/png' },
      { url: '/icon.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    locale: 'rw_RW',
    siteName: 'Milk System',
    title: "IHURIRO RY'AMATA | Milk System",
    description: 'Manage farmers, collection centers, milk collection, reports, and subscriptions.',
    images: [{ url: '/brand-logo-512.png', width: 512, height: 512, alt: "IHURIRO RY'AMATA | Milk System" }],
  },
  twitter: {
    card: 'summary',
    title: "IHURIRO RY'AMATA | Milk System",
    description: 'Manage farmers, collection centers, milk collection, reports, and subscriptions.',
    images: ['/brand-logo-512.png'],
  },
};

export const viewport: Viewport = { themeColor: '#1681ab' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="rw">
      <body>{children}</body>
    </html>
  );
}
