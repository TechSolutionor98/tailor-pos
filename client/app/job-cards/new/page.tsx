'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { JobCard } from '@/lib/types';
import { JobCardForm } from '@/components/JobCardForm';
import { useToast } from '@/components/Toast';

function NewJobCardContent() {
  const searchParams = useSearchParams();
  const copyFromId = searchParams?.get('copyFrom');
  const { toast } = useToast();
  const [copiedDoc, setCopiedDoc] = useState<JobCard | null>(null);
  const [loading, setLoading] = useState(Boolean(copyFromId));

  useEffect(() => {
    if (!copyFromId) {
      setLoading(false);
      return;
    }
    let live = true;
    (async () => {
      try {
        const doc = await api.jobCards.get(copyFromId);
        if (!live) return;
        setCopiedDoc(doc);
        toast(`Loaded details from Order #${doc.no || doc.ref}`, 'info');
      } catch (e) {
        if (!live) return;
        toast(e instanceof Error ? e.message : 'Could not copy order details', 'error');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [copyFromId, toast]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-ink-200" />
        <div className="h-64 animate-pulse rounded-2xl bg-ink-200" />
      </div>
    );
  }

  return <JobCardForm key={copiedDoc?._id ?? 'new'} mode="new" initial={copiedDoc} />;
}

export default function NewJobCardPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-10 w-64 animate-pulse rounded-xl bg-ink-200" />
          <div className="h-64 animate-pulse rounded-2xl bg-ink-200" />
        </div>
      }
    >
      <NewJobCardContent />
    </Suspense>
  );
}
