'use client';

import { Factory } from 'lucide-react';
import { SignupForm } from '@/components/auth/signup-form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser } from '@/firebase';
import { redirect } from 'next/navigation';

export default function SignupPage() {
  const { user, isUserLoading } = useUser();

  if(isUserLoading) {
    return <div>Loading...</div>
  }

  if (user) {
    redirect('/dashboard');
  }

  return (
    <main className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-950">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="text-center">
          <Factory className="mx-auto h-8 w-8" />
          <CardTitle className="mt-4 text-2xl font-bold tracking-tight">Create an account</CardTitle>
          <CardDescription className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Welcome! Please enter your details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </main>
  );
}
