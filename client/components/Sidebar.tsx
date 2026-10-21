'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/AuthContext';
import { Icon, type IconName } from '@/components/icons';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Hidden unless the signed-in user holds this permission. */
  permission: string;
}

interface NavGroup {
  section?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    items: [{ href: '/', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard.view' }],
  },
  {
    section: 'Tailoring',
    items: [
      { href: '/job-cards', label: 'All Orders', icon: 'jobcards', permission: 'jobcards.view' },
      { href: '/job-cards/ready', label: 'Ready Orders', icon: 'sparkle', permission: 'jobcards.view' },
      { href: '/job-cards/new', label: 'New Order', icon: 'plus', permission: 'jobcards.create' },
    ],
  },
  {
    section: 'Billing',
    items: [
      { href: '/sales', label: 'Sales / Return', icon: 'sales', permission: 'sales.view' },
      { href: '/sales/new', label: 'New Sale', icon: 'plus', permission: 'sales.create' },
    ],
  },
  {
    section: 'Masters',
    items: [
      { href: '/customers', label: 'Customers', icon: 'users', permission: 'ledgers.view' },
      { href: '/suppliers', label: 'Suppliers', icon: 'ledgers', permission: 'ledgers.view' },
      { href: '/measurements', label: 'Measurements', icon: 'scissors', permission: 'jobcards.view' },
      { href: '/ledgers', label: 'All Ledgers', icon: 'ledgers', permission: 'ledgers.view' },
      { href: '/products', label: 'Products', icon: 'products', permission: 'products.view' },
    ],
  },
  {
    section: 'Accounts',
    items: [{ href: '/payments', label: 'Payments', icon: 'payments', permission: 'payments.view' }],
  },
  {
    section: 'Admin',
    items: [
      { href: '/users', label: 'Users', icon: 'users', permission: 'users.manage' },
      { href: '/settings', label: 'Settings', icon: 'settings', permission: 'settings.manage' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/job-cards/new' || href === '/sales/new') return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname() ?? '/';
  const { can } = useAuth();

  // Close the drawer whenever the route changes, and on Escape.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // stop the page behind the drawer from scrolling
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Drop items the user cannot reach, then drop any group left empty.
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`no-print fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        id="app-sidebar"
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-[80vw] max-w-[17rem] shrink-0 flex-col border-r border-ink-800 bg-ink-950 text-ink-300 transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      <div className="flex items-center gap-3 border-b border-ink-800/80 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
          <Icon name="scissors" className="h-[22px] w-[22px]" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold tracking-tight text-white">Tailor POS</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            All in one
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="-mr-1 shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-900 hover:text-white lg:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g, gi) => (
          <div key={g.section ?? `group-${gi}`} className={gi === 0 ? '' : 'mt-5'}>
            {g.section && (
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-600">
                {g.section}
              </p>
            )}
            <div className="space-y-0.5">
              {g.items.map((n) => {
                const active = isActive(pathname, n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? 'bg-ink-800 font-semibold text-white'
                        : 'font-medium text-ink-400 hover:bg-ink-900 hover:text-ink-100'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-brand-500" />
                    )}
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                        active ? 'text-brand-400' : 'text-ink-500 group-hover:text-ink-300'
                      }`}
                    >
                      <Icon name={n.icon} />
                    </span>
                    {n.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-800/80 p-4">
        <div className="rounded-lg bg-ink-900 px-3.5 py-3 ring-1 ring-ink-800">
          <p className="text-[11px] font-bold text-ink-100">VAT 5% · AED</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
            United Arab Emirates tax profile applied to all bills.
          </p>
        </div>
      </div>
      </aside>
    </>
  );
}
