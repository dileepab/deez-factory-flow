'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { FIREBASE_AUTH_ERRORS } from '@/lib/constants';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/firebase/client';

const formSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string(),
});

export function LoginForm() {
  const { toast } = useToast();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      // Sign in the user. The AuthProvider will detect the change and the page guard
      // will handle the redirect once the user state is confirmed.
      await signInWithEmailAndPassword(auth, values.email, values.password);

      toast({
        title: 'Login Successful',
        description: "Welcome back! You're being redirected...",
      });

      // DO NOT redirect here. The page component will handle it.

    } catch (error: any) {
      console.error('Login error:', error);
      const errorMessage =
        FIREBASE_AUTH_ERRORS[error.code] || 'An unexpected error occurred.';
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: errorMessage,
      });
      form.resetField('password');
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  placeholder="m@example.com"
                  {...field}
                  autoComplete="email"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  {...field}
                  autoComplete="current-password"
                />
              </FormControl>
              <FormMessage />
            </To olItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Sign In
        </Button>
      </form>
    </Form>
  );
}
