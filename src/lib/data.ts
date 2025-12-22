import type { Operator, GarmentStyle, User, UserRole } from "./types";

export const USERS: Record<UserRole, User> = {
  admin: { id: "user-admin", name: "Admin User", role: "admin", email: "admin@factory.com", avatarUrl: "https://picsum.photos/seed/admin/40/40"},
  supervisor: { id: "user-supervisor", name: "Supervisor", role: "supervisor", email: "supervisor@factory.com", avatarUrl: "https://picsum.photos/seed/supervisor/40/40"},
  operator: { id: "user-operator-1", name: "Anusha Kumari", role: "operator", email: "anusha@factory.com", avatarUrl: "https://picsum.photos/seed/1/40/40"},
};


export const OPERATORS: Operator[] = [
  { id: "op-1", name: "Anusha Kumari", avatarUrl: "https://picsum.photos/seed/1/40/40", efficiency: 92, earnedMinutes: 441, totalProduction: 150, rework: 5 },
  { id: "op-2", name: "Nimal Perera", avatarUrl: "https://picsum.photos/seed/2/40/40", efficiency: 88, earnedMinutes: 422, totalProduction: 142, rework: 8 },
  { id: "op-3", name: "Saman Jayasinghe", avatarUrl: "https://picsum.photos/seed/3/40/40", efficiency: 85, earnedMinutes: 408, totalProduction: 135, rework: 4 },
  { id: "op-4", name: "Fathima Rizwan", avatarUrl: "https://picsum.photos/seed/4/40/40", efficiency: 95, earnedMinutes: 456, totalProduction: 160, rework: 2 },
  { id: "op-5", name: "Kavita Sharma", avatarUrl: "https://picsum.photos/seed/5/40/40", efficiency: 91, earnedMinutes: 437, totalProduction: 148, rework: 6 },
  { id: "op-6", name: "Ravi Prasad", avatarUrl: "https://picsum.photos/seed/6/40/40", efficiency: 82, earnedMinutes: 393, totalProduction: 130, rework: 10 },
  { id: "op-7", name: "Lakshmi Iyer", avatarUrl: "https://picsum.photos/seed/7/40/40", efficiency: 89, earnedMinutes: 427, totalProduction: 145, rework: 3 },
  { id: "op-8", name: "Dinesh Chandimal", avatarUrl: "https://picsum.photos/seed/8/40/40", efficiency: 86, earnedMinutes: 413, totalProduction: 138, rework: 7 },
];

export const GARMENT_STYLES: GarmentStyle[] = [
    {
        id: "style-101",
        name: "Men's Classic T-Shirt",
        operations: [
            { name: "Front & Back Cut", smv: 0.30 },
            { name: "Sleeve Cut", smv: 0.25 },
            { name: "Shoulder Join", smv: 0.45 },
            { name: "Sleeve Attach", smv: 0.60 },
            { name: "Side Seam", smv: 0.55 },
            { name: "Neck Rib Attach", smv: 0.70 },
            { name: "Bottom Hem", smv: 0.50 },
        ],
        totalSmv: 3.35
    },
    {
        id: "style-202",
        name: "Women's Denim Jeans",
        operations: [
            { name: "Panel Cutting", smv: 0.80 },
            { name: "Pocket Making", smv: 1.20 },
            { name: "Front Pocket Attach", smv: 0.90 },
            { name: "Back Pocket Attach", smv: 0.90 },
            { name: "Inseam/Outseam", smv: 1.50 },
            { name: "Waistband Attach", smv: 1.10 },
            { name: "Button & Zip Fly", smv: 1.30 },
            { name: "Bottom Hemming", smv: 0.80 },
        ],
        totalSmv: 8.50
    },
    {
        id: "style-303",
        name: "Kids Polo Shirt",
        operations: [
            { name: "Front & Back Cut", smv: 0.25 },
            { name: "Sleeve Cut", smv: 0.20 },
            { name: "Placket Making", smv: 0.80 },
            { name: "Collar Attach", smv: 0.75 },
            { name: "Sleeve Attach", smv: 0.50 },
            { name: "Side Seam", smv: 0.45 },
            { name: "Bottom Hem", smv: 0.40 },
        ],
        totalSmv: 3.35
    }
];
