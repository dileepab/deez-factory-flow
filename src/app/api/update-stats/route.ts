import { NextResponse } from 'next/server';
import { updateOperatorStats } from '@/lib/update-operator-stats';
import { updateStyleStats } from '@/lib/update-style-stats';

/**
 * This endpoint is triggered from the client-side after a production
 * entry is edited or deleted. It ensures that all relevant statistics
 * are recalculated.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { operatorId, styleId, date } = body;

    if (!operatorId || !styleId || !date) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    const entryDate = new Date(date);

    // Run both updates concurrently. The client needs to know the operatorId,
    // the styleId of the production entry, and the date the entry was for.
    await Promise.all([
      updateOperatorStats(operatorId, entryDate),
      updateStyleStats(styleId)
    ]);

    return NextResponse.json({ success: true, message: 'Statistics recalculated successfully.' });

  } catch (error) {
    console.error('Error in stats update endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }
}
