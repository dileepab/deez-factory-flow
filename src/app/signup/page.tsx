'use client';

import { Factory } from 'lucide-react';
import { SignupForm } from '@/components/auth/signup-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/auth-provider';
import { Loader } from '@/components/loader';

export default function SignupPage() {
  const { user, loading } = useAuth();

  if (loading || user) {
    return <Loader />;
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Factory size={48} />
          </div>
          <CardTitle className="text-2xl font-bold">Create an Account</CardTitle>
          <CardDescription>Enter your details to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </main>
  );
}
