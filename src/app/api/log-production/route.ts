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

    // Update Daily Plan Segment if startTime is provided (or we duplicate logic to find it)
    // We expect startTime in body now
    const { startTime } = body;
    if (typeof startTime === 'number') {
      const todayStr = date.split('T')[0]; // simple YYYY-MM-DD extraction from ISO
      const planRef = firestore.collection('daily_plans').doc(todayStr);

      // Transaction or simple update? Simple update is risky for array but map structure is safer.
      // schedules is a Map: operatorId -> ScheduleSegment[]
      // We need to read the doc to find the index? Firestore doesn't support updating array element by query.
      // We have to read, modify, write.

      try {
        await firestore.runTransaction(async (t) => {
          const doc = await t.get(planRef);
          if (!doc.exists) return;

          const data = doc.data();
          const schedules = data?.schedules || {};
          const userSchedule = schedules[operatorId] || [];

          // Find segment
          const idx = userSchedule.findIndex((s: any) => s.start === startTime && s.opId === operationId);

          if (idx !== -1) {
            userSchedule[idx].completed = true;
            schedules[operatorId] = userSchedule; // updating the array in the map
            t.update(planRef, { schedules });
          }
        });
      } catch (e) {
        console.error("Failed to update schedule completion flag", e);
        // Don't fail the whole request, logging is more important
      }
    }

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
