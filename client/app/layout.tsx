import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/Toast';
import { SettingsProvider } from '@/components/SettingsContext';
import { AuthProvider } from '@/components/AuthContext';
import { AppShell } from '@/components/AppShell';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Tailor POS — All in One',
  description: 'Modern tailor shop point of sale: stitching orders, sales, ledgers, inventory.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontSans.variable}>
      <body className={`${fontSans.className} font-sans`}>
        <ToastProvider>
          <AuthProvider>
            <SettingsProvider>
              <AppShell>{children}</AppShell>
            </SettingsProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
