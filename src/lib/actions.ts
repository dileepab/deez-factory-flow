'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, firestore } from '@/firebase/server';
import { FIREBASE_AUTH_ERRORS } from './constants';
import { UserRole, UserRoleSchema } from './types';
import type { EfficiencyImprovementSuggestionsOutput } from '@/ai/flows/efficiency-improvement-suggestions';
import { LineBalancerInputSchema } from '@/ai/flows/line-balancer-schemas';
import type { LineBalancerInput, LineBalancerOutput } from '@/ai/flows/line-balancer-schemas';

const signupSchema = z
  .object({
    email: z.string().email({ message: 'Please enter a valid email address.' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters long.' }),
    'confirm-password': z.string(),
    role: UserRoleSchema,
  })
  .refine((data) => data.password === data['confirm-password'], {
    message: "Passwords don't match.",
    path: ['confirm-password'],
  });

const AI_ALLOWED_ROLES = new Set<UserRole>(['admin', 'supervisor']);
const AI_API_KEY_ERROR =
  'AI planning is not configured. Add GEMINI_API_KEY or GOOGLE_API_KEY to your local or deployment environment, then restart the server.';

function hasAiApiKey() {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

function isMissingAiApiKeyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('GEMINI_API_KEY') || message.includes('GOOGLE_API_KEY');
}

async function getCurrentSessionUser(): Promise<{ uid: string; role: UserRole }> {
  const sessionCookie = (await cookies()).get('__session')?.value;
  if (!sessionCookie) {
    throw new Error('Authentication required.');
  }

  const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);
  const uid = decodedClaims.uid || decodedClaims.sub;
  if (!uid) {
    throw new Error('Invalid session.');
  }

  const userDoc = await firestore.collection('users').doc(uid).get();
  const role = userDoc.get('role') || decodedClaims.role;
  const parsedRole = UserRoleSchema.safeParse(role);
  if (!parsedRole.success) {
    throw new Error('User role is not configured.');
  }

  return { uid, role: parsedRole.data };
}

async function requireAiPlannerAccess() {
  const currentUser = await getCurrentSessionUser();
  if (!AI_ALLOWED_ROLES.has(currentUser.role)) {
    throw new Error('You do not have permission to use AI planning.');
  }
  return currentUser;
}

function validateLineBalancerOutput(
  input: LineBalancerInput,
  output: LineBalancerOutput
): LineBalancerOutput {
  const operationsById = new Map(input.style.operations.map(operation => [operation.id, operation]));
  const operatorsById = new Map(input.operators.map(operator => [operator.id, operator]));
  const seenOperations = new Set<string>();
  const machineOperators = new Map<string, Set<string>>();

  if (input.style.operations.length === 0) {
    throw new Error('Cannot balance a style with no operations.');
  }
  if (input.style.operations.length > 100 || input.operators.length > 200) {
    throw new Error('AI planning input is too large. Please reduce the planning scope.');
  }

  const assignments = output.assignments.map(assignment => {
    const operation = operationsById.get(assignment.operationId);
    if (!operation) {
      throw new Error(`AI returned an unknown operation: ${assignment.operationId}.`);
    }
    if (seenOperations.has(assignment.operationId)) {
      throw new Error(`AI returned duplicate assignments for operation: ${operation.name}.`);
    }

    const operatorIds = Array.from(new Set(assignment.operatorIds.filter(Boolean)));
    if (operatorIds.length === 0) {
      throw new Error(`AI left operation "${operation.name}" without an operator.`);
    }

    operatorIds.forEach(operatorId => {
      const operator = operatorsById.get(operatorId);
      if (!operator) {
        throw new Error(`AI returned an unknown operator for "${operation.name}".`);
      }
      if (!operator.skills.includes(operation.machineType)) {
        throw new Error(`AI assigned ${operator.name} to "${operation.name}" without the required ${operation.machineType} skill.`);
      }

      const operatorsForMachine = machineOperators.get(operation.machineType) || new Set<string>();
      operatorsForMachine.add(operatorId);
      machineOperators.set(operation.machineType, operatorsForMachine);
    });

    seenOperations.add(assignment.operationId);
    return {
      operationId: assignment.operationId,
      operatorIds,
    };
  });

  input.style.operations.forEach(operation => {
    if (!seenOperations.has(operation.id)) {
      throw new Error(`AI did not assign operation "${operation.name}".`);
    }
  });

  machineOperators.forEach((operatorIds, machineType) => {
    const availableCount = input.machineCounts[machineType];
    if (!Number.isFinite(availableCount) || availableCount < 1) {
      throw new Error(`Machine count is not configured for ${machineType}.`);
    }
    if (operatorIds.size > availableCount) {
      throw new Error(`AI used ${operatorIds.size} ${machineType} operators, but only ${availableCount} machines are available.`);
    }
  });

  return {
    assignments,
    reasoning: output.reasoning.trim(),
  };
}

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

    await firestore.collection('users').doc(user.uid).set({
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

    (await cookies()).set('__session', sessionCookie, {
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
  (await cookies()).delete('__session');
}

export async function logout() {
  const sessionCookie = (await cookies()).get('__session')?.value;
  if (sessionCookie) {
    try {
      const decodedClaims = await auth.verifySessionCookie(sessionCookie);
      await auth.revokeRefreshTokens(decodedClaims.sub);
    } catch (error) {
      console.error('Error revoking tokens:', error);
    }
  }
  await sessionLogout();
}

export async function getSuggestions(
  productionData: string,
  language = ''
): Promise<EfficiencyImprovementSuggestionsOutput | { error: string }> {
  try {
    await requireAiPlannerAccess();
    if (!hasAiApiKey()) {
      return { error: AI_API_KEY_ERROR };
    }

    const { getEfficiencyImprovementSuggestions } = await import('@/ai/flows/efficiency-improvement-suggestions');
    const suggestions = await getEfficiencyImprovementSuggestions({
      realTimeData: productionData,
      language
    });
    return suggestions;
  } catch (error: any) {
    if (isMissingAiApiKeyError(error)) {
      return { error: AI_API_KEY_ERROR };
    }

    console.error('Error getting AI suggestions:', error);
    return {
      error: `Server error: ${error.message}`,
    };
  }
}

export async function promoteToSupervisor(userId: string) {
  try {
    await auth.setCustomUserClaims(userId, { role: 'supervisor' });
    await firestore.collection('users').doc(userId).update({ role: 'supervisor' });
  } catch (error: any) {
    console.error('Error promoting user to supervisor:', error);
    throw new Error('Failed to promote user');
  }
}

export async function runLineBalancer(
  input: LineBalancerInput
): Promise<LineBalancerOutput | { error: string }> {
  try {
    await requireAiPlannerAccess();
    if (!hasAiApiKey()) {
      return { error: AI_API_KEY_ERROR };
    }

    const parsedInput = LineBalancerInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new Error('Invalid line balancing input.');
    }

    const { getLineBalancerSuggestions } = await import('@/ai/flows/line-balancer');
    const result = await getLineBalancerSuggestions(parsedInput.data);
    return validateLineBalancerOutput(parsedInput.data, result);
  } catch (error: any) {
    if (isMissingAiApiKeyError(error)) {
      return { error: AI_API_KEY_ERROR };
    }

    console.error('Error running AI line balancer:', error);
    return {
      error: `Server error: ${error.message}`,
    };
  }
}
