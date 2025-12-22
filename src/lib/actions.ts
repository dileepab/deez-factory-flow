'use server';

import { getEfficiencyImprovementSuggestions } from '@/ai/flows/efficiency-improvement-suggestions';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { UserRole } from './types';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { initializeFirebase }from '@/firebase/server';
import { admin } from '@/firebase/server';

const loginSchema = z.object({
  role: z.enum(['admin', 'supervisor', 'operator']),
});

export async function login(prevState: any, formData: FormData) {
  try {
    const validatedFields = loginSchema.safeParse({
      role: formData.get('role'),
    });

    if (!validatedFields.success) {
      return {
        message: 'Invalid role selected.',
      };
    }
    
    const role = validatedFields.data.role as UserRole;
    
    // The UID can be anything. For this demo, we'll use the role as the UID.
    const uid = role;
    const customToken = await admin.auth().createCustomToken(uid);

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
    
  } catch (error) {
    console.error(error);
    return {
      message: 'An unexpected error occurred.',
    };
  }
  redirect('/dashboard');
}

export async function logout() {
    cookies().delete('user-role');
    cookies().delete('custom-token');
    redirect('/');
}

const suggestionsSchema = z.object({
  productionData: z.string(),
});

export async function getSuggestions(productionData: string) {
  const validatedData = suggestionsSchema.safeParse({ productionData });
  if (!validatedData.success) {
    throw new Error('Invalid data provided for AI suggestions.');
  }

  try {
    const suggestions = await getEfficiencyImprovementSuggestions({
      realTimeData: validatedData.data.productionData,
    });
    return suggestions;
  } catch (error) {
    console.error('Error fetching AI suggestions:', error);
    return {
      suggestions: [
        'An error occurred while fetching suggestions. Please try again later.',
      ],
      reasoning:
        'The AI service might be temporarily unavailable or there was an internal error.',
    };
  }
}
