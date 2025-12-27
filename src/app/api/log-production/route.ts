import { NextResponse } from 'next/server';
import { firestore } from '@/firebase/server';
import { Timestamp } from 'firebase-admin/firestore';
import type { GarmentStyle, GarmentOperation } from '@/lib/types';

// This is the new, correct way to log production data.
// It creates a single, immutable record for each production event.
export async function POST(request: Request) {
  if (!firestore) {
    return NextResponse.json({ success: false, message: 'Firestore is not initialized' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const {
      operatorId,
      styleId,
      operationId,
      quantity,
      reworkQuantity = 0, // Default rework to 0 if not provided
      workedMinutes = 60, // Assume a 60-minute logging period if not provided
    } = body;

    // 1. Validate required fields
    if (!operatorId || !styleId || !operationId || !quantity) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    // 2. Fetch the GarmentStyle to find the operation's SMV (Standard Minute Value)
    const styleRef = firestore.collection('styles').doc(styleId);
    const styleDoc = await styleRef.get();

    if (!styleDoc.exists) {
      return NextResponse.json({ success: false, message: `Style with ID ${styleId} not found` }, { status: 404 });
    }

    const styleData = styleDoc.data() as GarmentStyle;
    const operation = styleData.operations.find(op => op.id === operationId);

    if (!operation || !operation.time) {
      return NextResponse.json({ success: false, message: `Operation with ID ${operationId} not found or has no SMV time in style ${styleId}` }, { status: 404 });
    }

    // 3. Perform calculations for this specific entry
    const smvInMinutes = operation.time / 60;
    const earnedMinutes = quantity * smvInMinutes;
    const efficiency = workedMinutes > 0 ? (earnedMinutes / workedMinutes) * 100 : 0;

    // 4. Create the new, enriched production document
    const newProductionRef = firestore.collection('production').doc();
    
    const newProductionData = {
      id: newProductionRef.id,
      operatorId,
      styleId,
      operationId,
      quantity,
      reworkQuantity,
      workedMinutes,
      earnedMinutes,
      efficiency: Math.round(efficiency), // Store efficiency as a percentage
      timestamp: Timestamp.now(),
    };

    await newProductionRef.set(newProductionData);

    return NextResponse.json({ success: true, data: newProductionData });

  } catch (error) {
    console.error('Error in log-production endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }
}