'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthContext';
import { LoginView } from '@/components/LoginView';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { Icon } from '@/components/icons';

/**
 * Permission required to open each route. Longest prefix wins, so
 * `/job-cards/new` is checked before `/job-cards`.
 */
const ROUTE_PERMISSIONS: { prefix: string; permission: string; exact?: boolean }[] = [
  { prefix: '/', permission: 'dashboard.view', exact: true },
  { prefix: '/job-cards/new', permission: 'jobcards.create', exact: true },
  { prefix: '/job-cards', permission: 'jobcards.view' },
  { prefix: '/sales/new', permission: 'sales.create', exact: true },
  { prefix: '/sales', permission: 'sales.view' },
  { prefix: '/ledgers', permission: 'ledgers.view' },
  { prefix: '/customers', permission: 'ledgers.view' },
  { prefix: '/suppliers', permission: 'ledgers.view' },
  { prefix: '/measurements', permission: 'jobcards.view' },
  { prefix: '/products', permission: 'products.view' },
  { prefix: '/payments', permission: 'payments.view' },
  { prefix: '/users', permission: 'users.manage' },
  { prefix: '/settings', permission: 'settings.manage' },
];

export function requiredPermission(pathname: string): string | null {
  const matches = ROUTE_PERMISSIONS.filter((r) =>
    r.exact ? pathname === r.prefix : pathname === r.prefix || pathname.startsWith(r.prefix + '/'),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.prefix.length - a.prefix.length)[0].permission;
}

/** Where to send someone whose role cannot see the dashboard. */
function firstAllowedPath(can: (p: string) => boolean): string {
  const order: [string, string][] = [
    ['/', 'dashboard.view'],
    ['/job-cards', 'jobcards.view'],
    ['/sales', 'sales.view'],
    ['/ledgers', 'ledgers.view'],
    ['/products', 'products.view'],
    ['/payments', 'payments.view'],
    ['/users', 'users.manage'],
    ['/settings', 'settings.manage'],
  ];
  return order.find(([, perm]) => can(perm))?.[0] ?? '/no-access';
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-brand-600 text-white">
          <Icon name="scissors" className="h-6 w-6" strokeWidth={2} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-400">
          Tailor POS
        </p>
      </div>
    </div>
  );
}

function NoAccess({ permission }: { permission: string }) {
  const { can } = useAuth();
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brass-50 text-brass-700">
          <Icon name="shield" className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-bold text-ink-950">You don&rsquo;t have access to this page</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          This screen needs the{' '}
          <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-700">
            {permission}
          </code>{' '}
          permission. Ask a Super Admin to grant it from the Users screen.
        </p>
        <button className="btn-soft mt-6" onClick={() => router.push(firstAllowedPath(can))}>
          Go to my start page
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, can } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname() ?? '/';
  const router = useRouter();

  const signedIn = Boolean(user);

  // Someone already signed in has no business on /login.
  useEffect(() => {
    if (signedIn && pathname === '/login') router.replace(firstAllowedPath(can));
  }, [signedIn, pathname, router, can]);

  if (loading) return <Splash />;
  if (!user) return <LoginView />;
  if (pathname === '/login') return <Splash />;

  const needed = requiredPermission(pathname);
  const allowed = needed === null || can(needed);

  // The order screen is a form filled left to right across the whole window,
  // so it runs to the edges: a strip of page around it is width the counter
  // could be reading figures in. Every other screen opens with a title, which
  // needs somewhere to sit.
  const fullBleed =
    /^\/job-cards\/[^/]+$/.test(pathname) &&
    pathname !== '/job-cards/ready' &&
    pathname !== '/ready-orders';

  return (
    <div className="flex min-h-screen">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main className={`print-full mx-auto w-full max-w-[1500px] flex-1 ${fullBleed ? '' : 'px-4 py-4 sm:px-6 sm:py-5'}`}>
          {allowed ? children : <NoAccess permission={needed as string} />}
        </main>
        <footer className="no-print px-4 pb-3 text-center text-[11px] text-ink-400 sm:px-6">
          Tailor POS · VAT 5% (UAE) · All amounts in AED
        </footer>
      </div>
    </div>
  );
}
