import { z } from 'zod';

// Base user schema
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Schema for user roles
export const UserRoleSchema = z.enum(['admin', 'supervisor', 'operator']);
export type UserRole = z.infer<typeof UserRoleSchema>;

// Schema for garment operations
export const GarmentOperationSchema = z.object({
  id: z.string(),
  name: z.string(),
  machineType: z.string(),
  time: z.number(), // in seconds
  dependencies: z.array(z.string()).optional(),
});
export type GarmentOperation = z.infer<typeof GarmentOperationSchema>;

// Schema for garment styles
export const GarmentStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string(),
  totalSmv: z.number(),
  operations: z.array(GarmentOperationSchema),
});
export type GarmentStyle = z.infer<typeof GarmentStyleSchema>;

// Schema for production logs
export const ProductionLogSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  styleId: z.string(),
  quantity: z.number(),
  hoursWorked: z.number(),
  date: z.string(), // ISO 8601 format
});
export type ProductionLog = z.infer<typeof ProductionLogSchema>;

// Extended user schema for operators
export const OperatorSchema = UserSchema.extend({
  efficiency: z.number(),
  earnedMinutes: z.number(),
  totalProduction: z.number(),
  rework: z.number(),
  reworkRate: z.number(),
  attendance: z.number(),
  assignedStyle: z.string().optional(),
  line: z.string().optional(),
  dailyProductions: z.array(ProductionLogSchema).optional(),
});
export type Operator = z.infer<typeof OperatorSchema>;

// You can also create a union type for different user profiles if needed
export const AnyUserSchema = z.union([
  UserSchema.extend({ role: z.literal('admin') }),
  UserSchema.extend({ role: z.literal('supervisor') }),
  OperatorSchema.extend({ role: z.literal('operator') }),
]);
export type AnyUser = z.infer<typeof AnyUserSchema>;

// Schema for AI-powered suggestions
export const SuggestionSchema = z.object({
  id: z.number(),
  text: z.string(),
  action: z.string(),
});

export const EfficiencyImprovementSuggestionsOutputSchema = z.array(SuggestionSchema);

export type EfficiencyImprovementSuggestionsOutput = z.infer<typeof EfficiencyImprovementSuggestionsOutputSchema>;
