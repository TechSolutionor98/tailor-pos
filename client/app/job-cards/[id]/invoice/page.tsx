'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { JobCard, Ledger } from '@/lib/types';
import { Card } from '@/components/ui';
import { OrderInvoice } from '@/components/OrderInvoice';
import { useSettings } from '@/components/SettingsContext';
import { useToast } from '@/components/Toast';

/**
 * An order's invoice, ready to print.
 *
 * `?print=1` opens the browser's print dialog as soon as the sheet is on
 * screen, which is how the Pay Now button and the Print action on the orders
 * list arrive here — a counter pressing either wants paper, not a preview.
 */
export default function InvoicePage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const autoPrint = searchParams?.get('print') === '1';
  const { settings } = useSettings();
  const { toast } = useToast();

  const [card, setCard] = useState<JobCard | null>(null);
  const [customer, setCustomer] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    let live = true;
    void (async () => {
      try {
        const c = await api.jobCards.get(id);
        if (!live) return;
        setCard(c);
        // The address and TRN live on the customer, not the order. A missing
        // one is not an error: a walk-in has no ledger at all.
        if (c.ledgerId) {
          try {
            const l = await api.ledgers.get(c.ledgerId);
            if (live) setCustomer(l);
          } catch {
            /* printed without them */
          }
        }
      } catch (e) {
        if (live) toast(e instanceof Error ? e.message : 'Could not load the order', 'error');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [params?.id, toast]);

  // Printed only once the sheet has actually rendered, otherwise the dialog
  // captures an empty page — and only once the letterhead has decoded, or it
  // prints with a gap where the logo should be. A mark hosted somewhere slow
  // is given three seconds and then printed around.
  useEffect(() => {
    if (!autoPrint || loading || !card) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const pending = Array.from(document.querySelectorAll('img'))
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((done) => {
              img.addEventListener('load', () => done(), { once: true });
              img.addEventListener('error', () => done(), { once: true });
            }),
        );
      void Promise.race([
        Promise.all(pending),
        new Promise((give) => setTimeout(give, 3000)),
      ]).then(() => {
        if (!cancelled) window.print();
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [autoPrint, loading, card]);

  if (loading) {
    return (
      <Card className="mx-auto max-w-4xl p-8">
        <div className="h-96 animate-pulse rounded-xl bg-ink-100" />
      </Card>
    );
  }

  if (!card) {
    return (
      <Card className="mx-auto max-w-4xl p-8 text-center">
        <p className="text-sm font-semibold text-ink-600">That order could not be loaded.</p>
        <Link href="/job-cards" className="btn-soft mt-4 inline-block">
          ← All orders
        </Link>
      </Card>
    );
  }

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <Link href="/job-cards" className="btn-soft">
          ← All orders
        </Link>
        <Link href={`/job-cards/${card._id}`} className="btn-soft">
          Edit order
        </Link>
        <Link
          href={`/job-cards/new?copyFrom=${card._id}`}
          className="btn-soft inline-flex items-center gap-1.5"
          title="Create a new stitching order with details from this order"
        >
          <span>＋</span>
          <span>New order</span>
        </Link>
        <button className="btn-primary ml-auto" onClick={() => window.print()}>
          🖨 Print / PDF
        </button>
      </div>

      {!settings.company.name && (
        <div className="no-print mb-5 rounded-2xl border border-brass-200 bg-brass-50 px-5 py-3 text-sm font-semibold text-brass-800">
          No company details yet, so the invoice prints without a letterhead. Add them under{' '}
          <Link href="/settings" className="underline">
            Settings → Invoice Details
          </Link>
          .
        </div>
      )}

      <Card className="print-full mx-auto max-w-[215mm] overflow-x-auto p-0 print:border-0 print:shadow-none">
        <OrderInvoice card={card} settings={settings} customer={customer} />
      </Card>
    </div>
  );
}
