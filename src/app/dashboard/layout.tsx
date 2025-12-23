'use client';

import { useAuth } from '@/auth-provider';
import { Loader } from '@/components/loader';
import { UserNav } from '@/components/dashboard/user-nav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return <Loader />;
  }

  return (
    <div className="flex-col md:flex">
      <div className="border-b">
        <div className="flex h-16 items-center px-4">
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome, {user.displayName || 'User'}
          </h1>
          <div className="ml-auto flex items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-4 p-8 pt-6">{children}</div>
    </div>
  );
}
