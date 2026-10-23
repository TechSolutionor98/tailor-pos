'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Ledger, Sale } from '@/lib/types';
import { Card } from '@/components/ui';
import { SaleInvoice } from '@/components/SaleInvoice';
import { SaleForm } from '@/components/SaleForm';
import { useSettings } from '@/components/SettingsContext';
import { useToast } from '@/components/Toast';

export default function SaleDetailPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const { settings } = useSettings();
  const [sale, setSale] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const autoPrint = searchParams?.get('print') === '1';
  const initialEdit = searchParams?.get('edit') === '1';
  const [isEditing, setIsEditing] = useState(initialEdit);

  useEffect(() => {
    if (searchParams?.get('edit') === '1') {
      setIsEditing(true);
    }
  }, [searchParams]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const s = await api.sales.get(params.id);
        if (!live) return;
        setSale(s);
        if (s.ledgerId) {
          try {
            const l = await api.ledgers.get(s.ledgerId);
            if (live) setCustomer(l);
          } catch {
            /* printed without ledger extra details */
          }
        }
      } catch (e) {
        if (live) toast(e instanceof Error ? e.message : 'Bill not found', 'error');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [params.id, toast]);

  // Arrived here from Save and print: wait for logos/images to decode then print
  useEffect(() => {
    if (isEditing || !autoPrint || loading || !sale) return;
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
  }, [isEditing, autoPrint, loading, sale]);

  if (loading) {
    return (
      <Card className="mx-auto max-w-4xl p-8">
        <div className="h-96 animate-pulse rounded-xl bg-ink-100" />
      </Card>
    );
  }

  if (!sale) {
    return (
      <Card className="mx-auto max-w-4xl p-8 text-center">
        <p className="text-sm font-semibold text-ink-600">That bill could not be loaded.</p>
        <Link href="/sales" className="btn-soft mt-4 inline-block">
          ← All bills
        </Link>
      </Card>
    );
  }

  if (isEditing) {
    return (
      <div className="space-y-4">
        <div className="no-print flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="btn-soft inline-flex items-center gap-1.5 font-bold"
          >
            <span>←</span>
            <span>Back to Invoice Preview</span>
          </button>
          <span className="text-xs font-bold text-ink-500">
            Editing Bill #{sale.billNo}
          </span>
        </div>
        <SaleForm
          initial={sale}
          mode="edit"
          onDone={async () => {
            setIsEditing(false);
            try {
              const updated = await api.sales.get(params.id);
              setSale(updated);
            } catch {
              /* ignore */
            }
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <Link href="/sales" className="btn-soft">
          ← All bills
        </Link>
        <Link href="/sales/new" className="btn-soft">
          + New sale
        </Link>
        <button
          type="button"
          className="btn-soft inline-flex items-center gap-1.5 font-bold text-brand-700 hover:bg-brand-50"
          onClick={() => setIsEditing(true)}
          title="Edit this sale / return bill"
        >
          <span>✏️</span>
          <span>Edit Bill</span>
        </button>
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
        <SaleInvoice sale={sale} settings={settings} customer={customer} />
      </Card>
    </div>
  );
}
