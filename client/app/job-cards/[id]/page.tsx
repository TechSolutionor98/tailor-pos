'use client';

import { Suspense, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { JobCard } from '@/lib/types';
import { JobCardForm } from '@/components/JobCardForm';
import { EmptyState } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function EditJobCardPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const [doc, setDoc] = useState<JobCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setDoc(await api.jobCards.get(params.id));
      } catch {
        setMissing(true);
        toast('Stitching order not found', 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-ink-200" />
        <div className="h-64 animate-pulse rounded-2xl bg-ink-200" />
      </div>
    );
  }

  if (missing || !doc) {
    return <EmptyState title="Stitching order not found" sub="It may have been deleted." />;
  }

  return (
    <Suspense fallback={null}>
      <JobCardForm key={doc._id} mode="edit" initial={doc} />
    </Suspense>
  );
}
