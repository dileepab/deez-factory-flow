"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, LogIn } from "lucide-react";
import { useAuth } from "@/firebase";
import { signInAnonymously } from "firebase/auth";
import { USERS } from "@/lib/data";
import type { UserRole } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing In..." : "Sign In"}
      {!pending && <LogIn className="ml-2 h-4 w-4" />}
    </Button>
  );
}

export function LoginForm() {
  const auth = useAuth();
  const [state, formAction] = useActionState(login, undefined);

  const handleLogin = (formData: FormData) => {
    const role = formData.get('role') as UserRole;
    if (auth && role) {
      const user = USERS[role];
      signInAnonymously(auth).then(() => {
        formAction(formData);
      }).catch((error) => {
        console.error("Anonymous sign-in error:", error);
      });
    } else {
      formAction(formData);
    }
  };

  return (
    <form action={handleLogin} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="role">Select Your Role</Label>
        <Select name="role" defaultValue="supervisor" required>
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
    </form>
  );
}
