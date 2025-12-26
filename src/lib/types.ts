import { Timestamp } from "firebase/firestore";
import { z } from "zod";
import { MACHINE_TYPES } from "./constants";

// Define the schema for validation
export const UserRoleSchema = z.enum(["admin", "supervisor", "operator"]);

// Infer the type from the schema
export type UserRole = z.infer<typeof UserRoleSchema>;

// Create a specific type for machine types from the constant
export type MachineType = typeof MACHINE_TYPES[number];

export interface User {
  id: string;
  name?: string;
  email?: string;
  photoURL?: string; // Add photoURL for user avatars
  role?: UserRole;
  // The efficiency field is added to the user document by the server.
  efficiency?: number;
}

export interface Operator extends User {
  role: "operator";
  efficiency: number;
  earnedMinutes: number;
  totalOperations: number;
  equivalentGarments: number; // New field for equivalent garments produced
  rework: number;
  reworkRate: number;
  attendance: number;
  assignedStyle?: string;
  line?: string;
  dailyProductions?: {
    date: Timestamp;
    totalOperations: number;
    earnedMinutes: number;
    efficiency: number;
  }[];
}

// This type is used in the leaderboard component.
export type OperatorWithEfficiency = User & {
  efficiency: number;
};

export interface Supervisor extends User {
  role: "supervisor";
  line: string;
  operators: string[]; // array of operator IDs
}

export interface GarmentOperation {
  id: string;
  name: string;
  time: number; // in seconds
  machineType: MachineType; // Use the specific type
  dependencies?: string[]; // array of operation IDs
}

export interface GarmentStyle {
  id: string;
  name: string;
  totalSmv: number;
  quantity: number;
  startDate: string;
  status: "active" | "completed";
  operations: GarmentOperation[];
}

export interface ProductionEntry {
  id: string;
  operatorId: string;
  operatorName: string;
  styleId: string;
  operationId: string;
  operationName: string;
  hourlyRange: string;
  cumulativeQuantity: number;
  reworkQuantity?: number;
  timestamp: Timestamp;
}
