'use client';

import { z } from 'zod';
import { MACHINE_TYPES } from '@/lib/constants';

export type UserRole = "operator" | "supervisor" | "admin";
export const UserRoleSchema = z.enum(["operator", "supervisor", "admin"]);

export type MachineType = typeof MACHINE_TYPES;

// --- CONFIGURATION TYPE ---

export interface Configuration {
    id: 'main'; // Singleton document
    targetSalaryLKR: number;
    workingDaysPerMonth: number;
    availableMinutesPerDay: number;
    attendanceBonusLKR: number;
    minuteValueLKR: number;
    holidays: string[]; // Array of dates in 'YYYY-MM-DD' format
    defaultSwitchDelay?: number; // Default delay in minutes when switching tasks/machines
    machineCounts?: Record<string, number>; // Inventory count per machine type
    customMachineTypes?: string[]; // User-defined machine types
}


// --- USER & AUTH TYPES ---

export interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    photoURL?: string; // Firebase Auth photo URL
    avatarUrl?: string; // Custom avatar URL if any
    line?: string; // Production line, primarily for supervisors and operators
    efficiency?: number; // For operators: Today's calculated efficiency
    earnedMinutes?: number; // For operators: Today's total earned minutes
    totalOperations?: number; // For operators: Today's total completed operations
    rework?: number; // For operators: Today's rework count
    equivalentGarments?: number; // For operators: Today's equivalent garments produced
    skills?: string[]; // Array of machine types the operator is skilled in
    efficiencyRating?: number; // Manual rating (default 100)
    monthlyStats?: {
        [key: string]: {
            totalEarnedMinutes: number;
            daysWorked: number;
            monthlyEfficiency: number;
            equivalentGarments?: number;
        }
    }
}

export interface Operator extends User {
    role: "operator";
}

export type OperatorWithEfficiency = User & {
    efficiency: number;
};

export interface Supervisor extends User {
    role: "supervisor";
    line: string;
    operators: string[]; // array of operator IDs
}

export type AnyUser = User | Operator | Supervisor;

// --- GARMENT & OPERATION TYPES ---

export interface GarmentOperation {
    id: string;
    name: string
    smv: number; // Standard Minute Value
    machineType: string; // Dynamic machine type string
    dependencies: string[];
    completedQuantity: number;
}

export interface GarmentStyle {
    id: string;
    name: string;
    buyer: string;
    totalSmv: number; // Total SMV for the entire garment in minutes
    operations: GarmentOperation[];
    quantity: number;
    status: 'active' | 'completed';
    startDate: string;
}


// --- PRODUCTION TYPES ---

// A generic Timestamp type to be compatible with both client and server Firestore SDKs.
export interface FirestoreTimestamp {
    seconds: number;
    nanoseconds: number;
    toDate(): Date;
}

export interface ProductionEntry {
    id?: string; // Is added client-side after fetching
    operatorId: string;
    styleId: string;
    operationId: string;
    cumulativeQuantity: number;
    reworkQuantity: number;
    hourlyRange: string;
    timestamp: FirestoreTimestamp;
}

export interface Assignment {
    operationId: string;
    operatorIds: string[];
}

export interface ScheduleSegment {
    start: number;
    end: number;
    opId: string;
    count: number;
    completed?: boolean;
}

export interface DailyPlan {
    date: FirestoreTimestamp;
    publishedBy: string;
    publishedAt: FirestoreTimestamp;
    styleId: string; // ID of the primary style
    nextStyleId?: string; // ID of the next style (if any)
    assignments: Assignment[];
    schedules: Record<string, ScheduleSegment[]>; // Key is operatorId
}
