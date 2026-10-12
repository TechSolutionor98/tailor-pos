'use client';

import { Suspense } from 'react';
import { SaleForm } from '@/components/SaleForm';

export default function NewSalePage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-ink-100" />}>
      <SaleForm />
    </Suspense>
  );
}
