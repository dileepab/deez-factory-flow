'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { admin, db } from '@/firebase/server';
import { FIREBASE_AUTH_ERRORS } from './constants';
import type { UserRole } from './types';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'supervisor', 'operator']),
});

export async function signup(prevState: any, formData: FormData) {
  const validatedFields = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
  });

  if (!validatedFields.success) {
    const errorMessages = validatedFields.error.flatten().fieldErrors;
    return {
      message: Object.values(errorMessages).join(', '),
    };
  }

  const { email, password, role } = validatedFields.data;

  try {
    const user = await admin.auth().createUser({
      email,
      password,
    });

    await admin.auth().setCustomUserClaims(user.uid, { role });
    
    await db.collection('users').doc(user.uid).set({
        email,
        role,
    });

    const customToken = await admin.auth().createCustomToken(user.uid);

    cookies().set('user-role', role, {
      httpOnly: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    cookies().set('custom-token', customToken, {
      httpOnly: true,
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });

  } catch (error: any) {
    return {
      message: FIREBASE_AUTH_ERRORS[error.code] || 'An unexpected error occurred.',
    };
  }

  redirect('/dashboard');
}


export async function sessionLogin(customToken: string) {
    try {
        const decodedToken = await admin.auth().verifyIdToken(customToken);
        const role = (decodedToken.role as UserRole) || 'operator';

        cookies().set('user-role', role, {
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60 * 24 * 7, // 1 week
        });

        cookies().set('custom-token', customToken, {
            httpOnly: true,
            path: '/',
            maxAge: 60 * 60, // 1 hour
        });

        redirect('/dashboard');
    } catch (error) {
        console.error(error);
        return {
            message: 'An unexpected error occurred.',
        };
    }
}

export async function logout() {
  cookies().delete('user-role');
  cookies().delete('custom-token');
  redirect('/');
}
