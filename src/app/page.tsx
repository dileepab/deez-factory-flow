'use client';

import { Factory } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/auth-provider';
import { Loader } from '@/components/loader';

export default function LoginPage() {
  const { user, loading } = useAuth();

  if (loading || user) {
    return <Loader />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-2xl">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Factory className="h-8 w-8" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">
              Welcome to FactoryFlow
            </CardTitle>
            <CardDescription>
              Sign in to access your dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
