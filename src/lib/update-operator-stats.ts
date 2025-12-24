import { firestore } from '@/firebase/server';
import { Timestamp } from 'firebase-admin/firestore';
import type { ProductionEntry, GarmentStyle } from '@/lib/types';

// Helper to get the start of the day for a given date
const getStartOfDay = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(start);
};

// Helper to get the end of the day for a given date
const getEndOfDay = (date: Date) => {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return Timestamp.fromDate(end);
};

export async function updateOperatorStats(operatorId: string, date: Date) {
  if (!firestore) {
    throw new Error("Firestore is not initialized.");
  }

  const startOfDay = getStartOfDay(date);
  const endOfDay = getEndOfDay(date);

  // 1. Fetch all production entries for the operator for the given day
  const productionQuery = firestore.collection('production')
    .where('operatorId', '==', operatorId)
    .where('timestamp', '>=', startOfDay)
    .where('timestamp', '<=', endOfDay);

  const productionSnapshot = await productionQuery.get();
  const productions = productionSnapshot.docs.map(doc => doc.data() as ProductionEntry);

  // 2. Fetch all relevant styles and their operations
  const styleIds = [...new Set(productions.map(p => p.styleId))].filter(id => id);
  const styles: GarmentStyle[] = [];
  if (styleIds.length > 0) {
    const stylesQuery = firestore.collection('styles').where('__name__', 'in', styleIds);
    const stylesSnapshot = await stylesQuery.get();
    stylesSnapshot.forEach(doc => styles.push({ id: doc.id, ...doc.data() } as GarmentStyle));
  }

  const allOperations = styles.flatMap(s => s.operations || []);

  // 3. Calculate stats
  let totalEarnedMinutes = 0;
  let totalOperations = 0; // Correctly named
  let totalRework = 0;

  for (const entry of productions) {
    const operation = allOperations.find(op => op.id === entry.operationId);
    if (operation && operation.time) {
        const smvInSeconds = operation.time;
        // Correctly convert SMV from seconds to minutes for the calculation
        totalEarnedMinutes += (entry.cumulativeQuantity || 0) * (smvInSeconds / 60);
    }
    totalOperations += entry.cumulativeQuantity || 0;
    totalRework += entry.reworkQuantity || 0;
  }

  // 4. Update the operator's document in the correct collection
  const operatorRef = firestore.collection('users').doc(operatorId);
  const batch = firestore.batch();

  batch.set(operatorRef, {
    earnedMinutes: totalEarnedMinutes,
    totalOperations: totalOperations, // Correctly named
    rework: totalRework,
  }, { merge: true });

  await batch.commit();

  return { success: true, totalEarnedMinutes, totalOperations };
}
