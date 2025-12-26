'use client';

import { useAuth } from '@/auth-provider';
import { UserRole } from '@/lib/types';
import { PageHeader } from '@/components/shared/page-header';
import { OperatorLeaderboard } from '@/components/dashboard/leaderboard';
import { AISuggestions } from '@/components/dashboard/ai-suggestions';
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
import { ProductionLog } from '@/components/dashboard/production-log';

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();

  const userDocRef = useMemoFirebase<DocumentReference | null>(
    () => (user ? doc(firestore, 'users', user.uid) : null),
    [user]
  );

  const { data: userData, isLoading: userDocLoading, error } = useDoc<{ role: UserRole }>(userDocRef);

  if (authLoading || !user || (user && userDocLoading)) {
    return <Loader />;
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
      <PageHeader title={`Welcome, ${user?.displayName || role}`} />
      <div className="mt-6 grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

        {role === 'operator' && (
            <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4">
                <OperatorDashboard />
            </div>
        )}

        {role === 'supervisor' && (
          <>
            <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-2">
              <ProductionEntry />
            </div>
            <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-2">
              <AISuggestions />
            </div>
            <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4">
              <ProductionLog />
            </div>
            <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4">
              <OperatorLeaderboard />
            </div>
          </>
        )}

        {role === 'admin' && (
          <>
            <div className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-4">
                <OperatorLeaderboard />
            </div>
            <div className="col-span-1 md:col-span-2">
                <StyleManagement />
            </div>
            <div className="col-span-1">
                <OperatorManagement />
            </div>
            <div className="col-span-1">
                <SupervisorManagement />
            </div>
          </>
        )}

      </div>
    </div>
  );
}
