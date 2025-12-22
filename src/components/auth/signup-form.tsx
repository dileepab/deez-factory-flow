'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { signup } from '@/lib/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, LogIn } from 'lucide-react';
import Link from 'next/link';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing Up...' : 'Sign Up'}
      {!pending && <LogIn className="ml-2 h-4 w-4" />}
    </Button>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState(signup, undefined);

  return (
    <form action={formAction} className="space-y-6">
        <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="m@example.com" required />
        </div>
        <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required />
        </div>
        <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input id="confirm-password" name="confirm-password" type="password" required />
        </div>
        <div className="space-y-2">
            <Label htmlFor="role">Select Your Role</Label>
            <Select name="role" defaultValue="operator" required>
            <SelectTrigger id="role" className="w-full">
                <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="supervisor">Supervisor</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
            </SelectContent>
            </Select>
        </div>

        {state?.message && (
            <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{state.message}</AlertDescription>
            </Alert>
        )}
        
        <SubmitButton />
        <div className="text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="underline">
            Sign in
            </Link>
        </div>
    </form>
  );
}
