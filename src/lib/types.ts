import { z } from 'zod';

export type UserRole = "operator" | "supervisor" | "admin";
export const UserRoleSchema = z.enum(["operator", "supervisor", "admin"]);

export type MachineType = "single-needle" | "overlock" | "flatlock" | "cover-stitch" | "bartack" | "other";

// --- USER & AUTH TYPES ---

export interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    line?: string; // Production line, primarily for supervisors and operators
    efficiency?: number; // For operators: Today's calculated efficiency
    earnedMinutes?: number; // For operators: Today's total earned minutes
    totalOperations?: number; // For operators: Today's total completed operations
    rework?: number; // For operators: Today's rework count
    equivalentGarments?: number; // For operators: Today's equivalent garments produced
    monthlyStats?: {
        [key: string]: {
            totalEarnedMinutes: number;
            daysWorked: number;
            monthlyEfficiency: number;
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

// --- GARMENT & OPERATION TYPES ---

export interface GarmentOperation {
    id: string;
    name: string;
    time: number; // SMV in seconds
    machineType: MachineType;
    dependencies?: string[]; // array of operation IDs
    completedQuantity?: number; // Total units completed for this operation
}

export interface GarmentStyle {
    id: string;
    name: string;
    totalSmv: number; // Total SMV for the entire garment in minutes
    quantity: number;
    startDate: string;
    status: "active" | "completed";
    operations: GarmentOperation[];
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
