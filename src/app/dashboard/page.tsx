'use client';

import { useAuth } from '@/auth-provider';
import { UserRole } from '@/lib/types';
import { OperatorDashboard } from '@/components/dashboard/operator-dashboard';
import { AdminDashboard } from '@/components/dashboard/admin-dashboard';
import { SupervisorDashboard } from '@/components/dashboard/supervisor-dashboard';
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
      {role === 'operator' && (
        <OperatorDashboard />
      )}

      {role === 'supervisor' && <SupervisorDashboard />}

      {role === 'admin' && <AdminDashboard />}

    </div>
  );
}
