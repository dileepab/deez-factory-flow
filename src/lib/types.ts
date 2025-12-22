export type UserRole = "admin" | "supervisor" | "operator";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  email: string;
  avatarUrl: string;
}

export interface Operator {
  id:string;
  name: string;
  avatarUrl: string;
  efficiency: number; // as a percentage
  earnedMinutes: number;
  totalProduction: number;
  rework: number;
  targetSalary: number;
  attendanceBonus: number;
}

export interface GarmentStyleOperation {
  name: string;
  smv: number; // Standard Minute Value
}

export interface GarmentStyle {
  id: string;
  name: string;
  operations: GarmentStyleOperation[];
  totalSmv: number;
}
