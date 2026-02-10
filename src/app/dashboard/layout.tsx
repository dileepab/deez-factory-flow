'use client';

import { Sidebar, SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { Header } from '@/components/shared/header';
import { SidebarNav } from '@/components/shared/sidebar-nav';
import { useAuth } from '@/auth-provider';
import { useDoc } from '@/firebase/firestore/use-doc';
import { doc, DocumentReference } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { UserRole } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Loader } from '@/components/loader';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user, loading: authLoading } = useAuth();

  const userDocRef = useMemoFirebase<DocumentReference | null>(
    () => (user ? doc(firestore, 'users', user.uid) : null),
    [user]
  );

  const { data: userData, isLoading: userDocLoading } = useDoc<{ role: UserRole }>(userDocRef);

  if (authLoading || (user && userDocLoading)) {
    return (
      <SidebarProvider defaultOpen={true}>
        <div className="flex w-full h-screen items-center justify-center">
          <Loader />
        </div>
      </SidebarProvider>
    );
  }

  const role = userData?.role;
  const isOperator = role === 'operator';

  return (
    <SidebarProvider defaultOpen={!isOperator}>
      {!isOperator && (
        <Sidebar>
          <SidebarNav />
        </Sidebar>
      )}
      <SidebarInset className="w-full overflow-x-hidden">
        <Header />
        <main className="flex-1 p-2 md:p-8 w-full max-w-[100vw] overflow-x-hidden">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
