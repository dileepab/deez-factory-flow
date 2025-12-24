import { NextResponse } from 'next/server';
import { updateOperatorStats } from '@/lib/update-operator-stats';

export async function POST(request: Request) {
  try {
    const { operatorId, date } = await request.json();

    if (!operatorId || !date) {
      return NextResponse.json({ success: false, message: 'Missing operatorId or date' }, { status: 400 });
    }

    const parsedDate = new Date(date);
    
    const result = await updateOperatorStats(operatorId, parsedDate);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in update-stats endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }
}
