
import { Timestamp } from "firebase/firestore";
import { z } from "zod";
import { MACHINE_TYPES } from "./constants";

// Define the schema for validation
export const UserRoleSchema = z.enum(["admin", "supervisor", "operator"]);

// Infer the type from the schema
export type UserRole = z.infer<typeof UserRoleSchema>;

// Create a specific type for machine types from the constant
export type MachineType = typeof MACHINE_TYPES[number];

// --- CORE USER & PROFILE TYPES ---
// Static user data. Does not contain dynamic production stats.
export interface User {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string;
  role?: UserRole;
}

export interface Operator extends User {
  role: "operator";
  // All dynamic production data has been moved to the 'production' collection.
  // This document should only contain static or slowly changing information.
  targetSalary?: number;
  assignedStyle?: string;
  line?: string;
}

// This type is used for displaying calculated data in the UI.
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

// --- PRODUCTION DATA TYPE ---
// Represents a single, immutable production log event.
// This is the new source of truth for all performance data.
export interface ProductionEntry {
  id: string;
  operatorId: string;
  styleId: string;
  operationId: string;
  timestamp: Timestamp;

  // Core production metrics for this specific entry
  cumulativeQuantity: number;
  reworkQuantity: number;
  workedMinutes: number;

  // Calculated values, stored for efficient querying
  earnedMinutes: number;
  efficiency: number; // as a percentage (e.g., 85.5)
}