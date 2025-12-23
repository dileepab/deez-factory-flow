'use client';

import { redirect } from 'next/navigation';
import { useAuth } from '@/auth-provider';
import type { UserRole } from '@/lib/types';
import { PageHeader } from '@/components/shared/page-header';
import { Leaderboard } from '@/components/dashboard/leaderboard';
import { AiSuggestions } from '@/components/dashboard/ai-suggestions';
import { StyleManagement } from '@/components/dashboard/style-management';
import { ProductionEntry } from '@/components/dashboard/production-entry';
import { OperatorDashboard } from '@/components/dashboard/operator-dashboard';
import { OperatorManagement } from '@/components/dashboard/operator-management';
import { SupervisorManagement } from '@/components/dashboard/supervisor-management';
import { doc, DocumentReference } from 'firebase/firestore';
import { useDoc } from '@/firebase/firestore/use-doc';
import { firestore } from '@/firebase/client';
import { Loader } from '@/components/loader';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();

  const userDocRef = useMemoFirebase<DocumentReference | null>(
    () => (user ? doc(firestore, 'users', user.uid) : null),
    [user]
  );

  const { data: userData, isLoading: userDocLoading, error } = useDoc<{ role: UserRole }>(userDocRef);

  if (authLoading || (user && userDocLoading)) {
    return <Loader />;
  }

  if (!user) {
    return redirect('/');
  }

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="text-center">
            <h2 className="text-xl font-bold text-destructive">Error</h2>
            <p className="text-muted-foreground">{error?.message || 'An unknown error occurred.'}</p>
        </div>
      </div>
    );
  }

  const role = userData?.role;

  if (!role) {
    return <Loader />;
  }

  return (
    <div>
      <PageHeader title={`Welcome, ${role}`} />
      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {role === 'operator' && <OperatorDashboard />}
        {role !== 'operator' && (
          <>
            <div className="lg:col-span-2">
              <Leaderboard />
            </div>
            <AiSuggestions />
          </>
        )}
        {role === 'admin' && (
          <>
            <StyleManagement />
            <OperatorManagement />
            <SupervisorManagement />
          </>
        )}
        {role === 'supervisor' && <ProductionEntry />}
      </div>
    </div>
  );
}
