'use client';

import { AIProductionPlanner } from '@/components/dashboard/ai-production-planner';
import { useAuth } from '@/auth-provider';
import { Loader } from '@/components/loader';
import { useDoc } from '@/firebase/firestore/use-doc';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { firestore } from '@/firebase/client';
import { doc, DocumentReference } from 'firebase/firestore';
import type { UserRole } from '@/lib/types';

export default function AIProductionPage() {
    const { user, loading: authLoading } = useAuth();
    const userDocRef = useMemoFirebase<DocumentReference | null>(
        () => (user ? doc(firestore, 'users', user.uid) : null),
        [user]
    );
    const { data: userData, isLoading: userDocLoading } = useDoc<{ role: UserRole }>(userDocRef);

    if (authLoading || userDocLoading) {
        return <Loader />;
    }

    if (userData?.role !== 'admin' && userData?.role !== 'supervisor') {
        return (
            <div className="fixed inset-0 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-destructive">Access Denied</h2>
                    <p className="text-muted-foreground">You do not have permission to use AI production planning.</p>
                </div>
            </div>
        );
    }

    return <AIProductionPlanner />;
}
