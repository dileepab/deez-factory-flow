import type { GarmentStyle, Operator } from './types';

export const GARMENT_STYLES: GarmentStyle[] = [
  {
    id: 'style-1',
    name: 'Classic Crew Neck T-Shirt',
    totalSmv: 0, // Will be calculated
    operations: [
      { id: 'op-1-1', name: 'Cut Fabric', time: 15, machineType: 'Single Needle Lockstitch', dependencies: [] },
      { id: 'op-1-2', name: 'Sew Shoulder Seams', time: 25, machineType: 'Overlock/Serger', dependencies: ['op-1-1'] },
      { id: 'op-1-3', name: 'Attach Neckband', time: 45, machineType: 'Flatlock/Coverstitch', dependencies: ['op-1-2'] },
      { id: 'op-1-4', name: 'Sew Side Seams', time: 40, machineType: 'Overlock/Serger', dependencies: ['op-1-3'] },
      { id: 'op-1-5', name: 'Hem Sleeves', time: 30, machineType: 'Flatlock/Coverstitch', dependencies: ['op-1-4'] },
      { id: 'op-1-6', name: 'Hem Bottom', time: 35, machineType: 'Flatlock/Coverstitch', dependencies: ['op-1-5'] },
      { id: 'op-1-7', name: 'Final Inspection', time: 20, machineType: 'Single Needle Lockstitch', dependencies: ['op-1-6'] },
    ],
  },
  {
    id: 'style-2',
    name: 'V-Neck T-Shirt',
    totalSmv: 0,
    operations: [
      { id: 'op-2-1', name: 'Cut Fabric', time: 15, machineType: 'Single Needle Lockstitch', dependencies: [] },
      { id: 'op-2-2', name: 'Sew Shoulder Seams', time: 25, machineType: 'Overlock/Serger', dependencies: ['op-2-1'] },
      { id: 'op-2-3', name: 'Attach V-Neckband', time: 55, machineType: 'Flatlock/Coverstitch', dependencies: ['op-2-2'] },
      { id: 'op-2-4', name: 'Sew Side Seams', time: 40, machineType: 'Overlock/Serger', dependencies: ['op-2-3'] },
      { id: 'op-2-5', name: 'Hem Sleeves', time: 30, machineType: 'Flatlock/Coverstitch', dependencies: ['op-2-4'] },
      { id: 'op-2-6', name: 'Hem Bottom', time: 35, machineType: 'Flatlock/Coverstitch', dependencies: ['op-2-5'] },
      { id: 'op-2-7', name: 'Final Inspection', time: 20, machineType: 'Single Needle Lockstitch', dependencies: ['op-2-6'] },
    ],
  },
  {
    id: 'style-3',
    name: 'Polo Shirt',
    totalSmv: 0,
    operations: [
      { id: 'op-3-1', name: 'Cut Fabric', time: 20, machineType: 'Single Needle Lockstitch', dependencies: [] },
      { id: 'op-3-2', name: 'Create Placket', time: 60, machineType: 'Single Needle Lockstitch', dependencies: ['op-3-1'] },
      { id: 'op-3-3', name: 'Attach Collar', time: 50, machineType: 'Single Needle Lockstitch', dependencies: ['op-3-2'] },
      { id: 'op-3-4', name: 'Sew Shoulder Seams', time: 25, machineType: 'Overlock/Serger', dependencies: ['op-3-3'] },
      { id: 'op-3-5', name: 'Attach Sleeves', time: 50, machineType: 'Overlock/Serger', dependencies: ['op-3-4'] },
      { id: 'op-3-6', name: 'Sew Side Seams', time: 40, machineType: 'Overlock/Serger', dependencies: ['op-3-5'] },
      { id: 'op-3-7', name: 'Create Buttonholes', time: 30, machineType: 'Buttonhole Machine', dependencies: ['op-3-6'] },
      { id: 'op-3-8', name: 'Attach Buttons', time: 40, machineType: 'Button Attach Machine', dependencies: ['op-3-7'] },
      { id: 'op-3-9', name: 'Hem Bottom', time: 35, machineType: 'Flatlock/Coverstitch', dependencies: ['op-3-6'] },
      { id: 'op-3-10', name: 'Final Inspection', time: 25, machineType: 'Single Needle Lockstitch', dependencies: ['op-3-8', 'op-3-9'] },
    ],
  },
];

export const OPERATORS: Operator[] = [
    {
      id: 'op-1',
      name: 'John Doe',
      efficiency: 95.5,
      reworkRate: 2.1,
      attendance: 100,
      assignedStyle: 'Classic Crew Neck T-Shirt',
      dailyProductions: [
        { date: '2024-05-20', quantity: 50 },
        { date: '2024-05-21', quantity: 52 },
        { date: '2024-05-22', quantity: 48 },
      ],
    },
    {
      id: 'op-2',
      name: 'Jane Smith',
      efficiency: 98.2,
      reworkRate: 1.5,
      attendance: 95,
      assignedStyle: 'V-Neck T-Shirt',
      dailyProductions: [
        { date: '2024-05-20', quantity: 60 },
        { date: '2024-05-21', quantity: 58 },
        { date: '2024-05-22', quantity: 62 },
      ],
    },
    {
      id: 'op-3',
      name: 'Peter Jones',
      efficiency: 92.0,
      reworkRate: 3.0,
      attendance: 98,
      assignedStyle: 'Polo Shirt',
      dailyProductions: [
        { date: '2024-05-20', quantity: 40 },
        { date: '2024-05-21', quantity: 45 },
        { date: '2024-05-22', quantity: 42 },
      ],
    },
];
