import { NextResponse } from 'next/server';
import { firestore } from '@/firebase/server';
import { Timestamp } from 'firebase-admin/firestore';
import { updateOperatorStats } from '@/lib/update-operator-stats';
import { updateStyleStats } from '@/lib/update-style-stats'; // Import the new function

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
      reworkQuantity = 0,
      hourlyRange,
      date,
    } = body;

    if (!operatorId || !styleId || !operationId || !quantity || !date || !hourlyRange) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    const entryDate = new Date(date);

    const newEntry = {
      operatorId,
      styleId,
      operationId,
      cumulativeQuantity: quantity,
      reworkQuantity,
      hourlyRange,
      timestamp: Timestamp.fromDate(entryDate),
    };

    await firestore.collection('production').add(newEntry);

    // Run both stat updates concurrently for efficiency
    await Promise.all([
      updateOperatorStats(operatorId, entryDate),
      updateStyleStats(styleId)
    ]);

    return NextResponse.json({ success: true, message: 'Production logged and all stats updated' });

  } catch (error) {
    console.error('Error in log-production endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }
}
