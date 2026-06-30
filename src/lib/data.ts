import type { GarmentStyle, Operator } from './types';

export const GARMENT_STYLES: GarmentStyle[] = [
  {
    id: 'style-crewneck-tshirt',
    name: 'Classic Crewneck T-Shirt',
    buyer: 'Thread & Co.',
    totalSmv: 4.80,
    quantity: 500,
    status: 'active',
    startDate: '2026-06-27',
    variants: [
      { id: 'v-tshirt-floral', color: 'Floral Print', quantity: 200 },
      { id: 'v-tshirt-navy', color: 'Solid Navy', quantity: 150 },
      { id: 'v-tshirt-coral', color: 'Coral', quantity: 150 }
    ],
    operations: [
      { id: 'op_tshirt_shoulder', name: 'Shoulder Join', smv: 30, machineType: 'Overlock/Serger', dependencies: [], completedQuantity: 0 },
      { id: 'op_tshirt_neck_rib', name: 'Neck Rib Attach', smv: 54, machineType: 'Overlock/Serger', dependencies: ['op_tshirt_shoulder'], completedQuantity: 0 },
      { id: 'op_tshirt_neck_tape', name: 'Neck Tape & Topstitch', smv: 42, machineType: 'Single Needle Lockstitch', dependencies: ['op_tshirt_neck_rib'], completedQuantity: 0 },
      { id: 'op_tshirt_sleeve_attach', name: 'Sleeve Attach', smv: 60, machineType: 'Overlock/Serger', dependencies: ['op_tshirt_shoulder'], completedQuantity: 0 },
      { id: 'op_tshirt_side_seam', name: 'Side Seam', smv: 54, machineType: 'Overlock/Serger', dependencies: ['op_tshirt_sleeve_attach'], completedQuantity: 0 },
      { id: 'op_tshirt_hem', name: 'Sleeve & Bottom Hem', smv: 48, machineType: 'Flatlock/Coverstitch', dependencies: ['op_tshirt_side_seam'], completedQuantity: 0 }
    ]
  },
  {
    id: 'style-premium-polo',
    name: 'Premium Polo Shirt',
    buyer: 'Heritage Apparel',
    totalSmv: 8.50,
    quantity: 400,
    status: 'active',
    startDate: '2026-06-27',
    variants: [
      { id: 'v-polo-navy', color: 'Solid Navy', quantity: 150 },
      { id: 'v-polo-black', color: 'Black', quantity: 150 },
      { id: 'v-polo-darkblue', color: 'Dark Blue', quantity: 100 }
    ],
    operations: [
      { id: 'op_polo_shoulder', name: 'Shoulder Join', smv: 36, machineType: 'Overlock/Serger', dependencies: [], completedQuantity: 0 },
      { id: 'op_polo_placket', name: 'Placket Attach', smv: 108, machineType: 'Single Needle Lockstitch', dependencies: [], completedQuantity: 0 },
      { id: 'op_polo_collar', name: 'Collar Attach', smv: 84, machineType: 'Single Needle Lockstitch', dependencies: ['op_polo_shoulder', 'op_polo_placket'], completedQuantity: 0 },
      { id: 'op_polo_sleeve_attach', name: 'Sleeve Attach', smv: 72, machineType: 'Overlock/Serger', dependencies: ['op_polo_shoulder'], completedQuantity: 0 },
      { id: 'op_polo_side_seam', name: 'Side Seam', smv: 66, machineType: 'Overlock/Serger', dependencies: ['op_polo_sleeve_attach'], completedQuantity: 0 },
      { id: 'op_polo_hem', name: 'Bottom Hem', smv: 60, machineType: 'Flatlock/Coverstitch', dependencies: ['op_polo_side_seam'], completedQuantity: 0 },
      { id: 'op_polo_buttons', name: 'Buttonhole & Button', smv: 84, machineType: 'Buttonhole Machine', dependencies: ['op_polo_placket'], completedQuantity: 0 }
    ]
  },
  {
    id: 'style-chino-pants',
    name: 'Slim Fit Chino Pants',
    buyer: 'Apex Denim',
    totalSmv: 12.00,
    quantity: 300,
    status: 'active',
    startDate: '2026-06-27',
    variants: [
      { id: 'v-chino-black', color: 'Black', quantity: 150 },
      { id: 'v-chino-darkblue', color: 'Dark Blue', quantity: 150 }
    ],
    operations: [
      { id: 'op_chino_pocket', name: 'Pocket Stitching', smv: 120, machineType: 'Single Needle Lockstitch', dependencies: [], completedQuantity: 0 },
      { id: 'op_chino_zipper', name: 'Fly & Zipper Attach', smv: 150, machineType: 'Single Needle Lockstitch', dependencies: [], completedQuantity: 0 },
      { id: 'op_chino_inseam', name: 'Inseam Join', smv: 90, machineType: 'Overlock/Serger', dependencies: ['op_chino_pocket', 'op_chino_zipper'], completedQuantity: 0 },
      { id: 'op_chino_outseam', name: 'Outseam Join', smv: 108, machineType: 'Overlock/Serger', dependencies: ['op_chino_inseam'], completedQuantity: 0 },
      { id: 'op_chino_waistband', name: 'Waistband Join', smv: 132, machineType: 'Waist Band (Kansai)', dependencies: ['op_chino_outseam'], completedQuantity: 0 },
      { id: 'op_chino_hem', name: 'Bottom Hem', smv: 60, machineType: 'Flatlock/Coverstitch', dependencies: ['op_chino_outseam'], completedQuantity: 0 },
      { id: 'op_chino_buttons', name: 'Buttonhole & Waist Button', smv: 60, machineType: 'Buttonhole Machine', dependencies: ['op_chino_waistband'], completedQuantity: 0 }
    ]
  },
  {
    id: 'style-shift-dress',
    name: 'Summer Shift Dress',
    buyer: 'Coral Reef Fashion',
    totalSmv: 5.75,
    quantity: 400,
    status: 'active',
    startDate: '2026-06-27',
    variants: [
      { id: 'v-dress-floral', color: 'Floral Print', quantity: 200 },
      { id: 'v-dress-navy', color: 'Solid Navy', quantity: 100 },
      { id: 'v-dress-coral', color: 'Coral', quantity: 100 }
    ],
    operations: [
      { id: 'op_dress_shoulder', name: 'Shoulder Join', smv: 45, machineType: 'Overlock/Serger', dependencies: [], completedQuantity: 0 },
      { id: 'op_dress_neck', name: 'Neck Binding', smv: 75, machineType: 'Piping Attach with Single Needle', dependencies: ['op_dress_shoulder'], completedQuantity: 0 },
      { id: 'op_dress_sleeve', name: 'Sleeve Attach', smv: 60, machineType: 'Overlock/Serger', dependencies: ['op_dress_shoulder'], completedQuantity: 0 },
      { id: 'op_dress_side_seam', name: 'Side Seam', smv: 75, machineType: 'Overlock/Serger', dependencies: ['op_dress_sleeve'], completedQuantity: 0 },
      { id: 'op_dress_hem', name: 'Bottom Hem', smv: 90, machineType: 'Flatlock/Coverstitch', dependencies: ['op_dress_side_seam'], completedQuantity: 0 }
    ]
  }
];


export const OPERATORS: Operator[] = [
    {
      id: 'op-1',
      name: 'John Doe',
      email: 'john.doe@example.com',
      role: 'operator',
      efficiency: 95.5,
      earnedMinutes: 0,
      rework: 5,
      line: 'Line 1',
      skills: ['Single Needle Lockstitch', 'Overlock/Serger'],
      efficiencyRating: 95,
    },
    {
      id: 'op-2',
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      role: 'operator',
      efficiency: 98.2,
      earnedMinutes: 0,
      rework: 3,
      line: 'Line 2',
      skills: ['Overlock/Serger'],
      efficiencyRating: 98,
    },
    {
      id: 'op-3',
      name: 'Peter Jones',
      email: 'peter.jones@example.com',
      role: 'operator',
      efficiency: 92.0,
      earnedMinutes: 0,
      rework: 8,
      line: 'Line 1',
      skills: ['Single Needle Lockstitch', 'Buttonhole Machine'],
      efficiencyRating: 92,
    },
];
