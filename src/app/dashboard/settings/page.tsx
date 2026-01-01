'use client';

import { ConfigurationManagement } from '@/components/dashboard/configuration-management';
import { useAuth } from '@/auth-provider';
import { UserRole } from '@/lib/types';
import { Loader } from '@/components/loader';
import { doc, DocumentReference } from 'firebase/firestore';
import { useDoc } from '@/firebase/firestore/use-doc';
import { firestore } from '@/firebase/client';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';

// Page component for displaying the settings management UI
export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();

  const userDocRef = useMemoFirebase<DocumentReference | null>(
    () => (user ? doc(firestore, 'users', user.uid) : null),
    [user]
  );

  const { data: userData, isLoading: userDocLoading } = useDoc<{ role: UserRole }>(userDocRef);

  if (authLoading || userDocLoading) {
    return <Loader />;
  }

  // Ensure only admin users can view this page
  if (userData?.role !== 'admin') {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-destructive">Access Denied</h2>
          <p className="text-muted-foreground">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <ConfigurationManagement />
    </div>
  );
}
