'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Sale } from '@/lib/types';
import { Card } from '@/components/ui';
import { SaleForm } from '@/components/SaleForm';
import { useToast } from '@/components/Toast';

export default function EditSalePage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const [sale, setSale] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const s = await api.sales.get(params.id);
        if (!live) return;
        setSale(s);
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

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between">
        <Link
          href={`/sales/${sale._id}`}
          className="btn-soft inline-flex items-center gap-1.5 font-bold"
        >
          <span>←</span>
          <span>Back to Invoice Preview</span>
        </Link>
        <span className="text-xs font-bold text-ink-500">
          Editing Bill #{sale.billNo}
        </span>
      </div>
      <SaleForm initial={sale} mode="edit" />
    </div>
  );
}
