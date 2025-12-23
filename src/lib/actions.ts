'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, db } from '@/firebase/server';
import { FIREBASE_AUTH_ERRORS } from './constants';
import type { UserRole, Operator } from './types';
import { getEfficiencyImprovementSuggestions } from '@/ai/flows/efficiency-improvement-suggestions';
import type { EfficiencyImprovementSuggestionsOutput } from '@/ai/flows/efficiency-improvement-suggestions';

const signupSchema = z
  .object({
    email: z.string().email({ message: 'Please enter a valid email address.' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long.' }),
    'confirm-password': z.string(),
    role: z.enum(['admin', 'supervisor', 'operator']),
  })
  .refine((data) => data.password === data['confirm-password'], {
    message: "Passwords don't match.",
    path: ['confirm-password'],
  });

export async function signup(prevState: any, formData: FormData) {
  const validatedFields = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    'confirm-password': formData.get('confirm-password'),
    role: formData.get('role'),
  });

  if (!validatedFields.success) {
    const errorMessages = validatedFields.error.flatten().fieldErrors;
    const messages = Object.values(errorMessages).flat();
    return {
      message: messages.join(' '),
    };
  }

  const { email, password, role } = validatedFields.data;

  try {
    const user = await auth.createUser({
      email,
      password,
    });

    await auth.setCustomUserClaims(user.uid, { role });

    await db.collection('users').doc(user.uid).set({
      email,
      role,
    });

    return { success: true };

  } catch (error: any) {
    console.error('Signup error:', error);
    return {
      success: false,
      message: FIREBASE_AUTH_ERRORS[error.code] || `Server error: ${error.message}`,
    };
  }
}

export async function sessionLogin(idToken: string) {
  try {
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });

    cookies().set('__session', sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: true,
      path: '/',
    });

    return { success: true };
  } catch (error: any) {
    console.error('Session login error:', error);
    return {
      success: false,
      message: `Server error: ${error.message}`,
    };
  }
}

export async function sessionLogout() {
  cookies().delete('__session');
}

export async function logout() {
  const sessionCookie = cookies().get('__session')?.value;
  if (sessionCookie) {
    try {
      const decodedClaims = await auth.verifySessionCookie(sessionCookie);
      await auth.revokeRefreshTokens(decodedClaims.sub);
    } catch (error) {
      console.error('Error revoking tokens:', error);
    }
  }
  await sessionLogout();
  redirect('/');
}

export async function getSuggestions(
  productionData: string
): Promise<EfficiencyImprovementSuggestionsOutput | { error: string }> {
  try {
    const suggestions = await getEfficiencyImprovementSuggestions(productionData);
    return suggestions;
  } catch (error: any) {
    console.error('Error getting AI suggestions:', error);
    return {
      error: `Server error: ${error.message}`,
    };
  }
}

export async function promoteToSupervisor(userId: string) {
  try {
    await auth.setCustomUserClaims(userId, { role: 'supervisor' });
    await db.collection('users').doc(userId).update({ role: 'supervisor' });
  } catch (error: any) {
    console.error('Error promoting user to supervisor:', error);
    throw new Error('Failed to promote user');
  }
}
