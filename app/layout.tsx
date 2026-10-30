import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.ihuriroryamata.com'),
  title: "IHURIRO RY'AMATA | Milk System",
  description: 'Ihuriro ry’Amata (Ihuriroryamata), rizwi nka Milk System, rifasha abacunda n’ibigo by’ikusanyirizo gucunga aborozi, ikusanya n’inyandiko z’amata, n’ibaruramari ry’ukwezi.',
  applicationName: "IHURIRO RY'AMATA | Milk System",
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
    description: 'Ihuriro ry’Amata (Ihuriroryamata), rizwi nka Milk System, rifasha abacunda n’ibigo by’ikusanyirizo gucunga aborozi, ikusanya n’inyandiko z’amata, n’ibaruramari ry’ukwezi.',
    images: [{ url: 'https://www.ihuriroryamata.com/brand-logo-512.png', width: 512, height: 512, alt: "IHURIRO RY'AMATA | Milk System" }],
  },
  twitter: {
    card: 'summary',
    title: "IHURIRO RY'AMATA | Milk System",
    description: 'Ihuriro ry’Amata (Ihuriroryamata), rizwi nka Milk System, rifasha abacunda n’ibigo by’ikusanyirizo gucunga aborozi, ikusanya n’inyandiko z’amata, n’ibaruramari ry’ukwezi.',
    images: ['https://www.ihuriroryamata.com/brand-logo-512.png'],
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
