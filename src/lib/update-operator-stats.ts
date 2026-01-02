import { firestore } from '@/firebase/server';
import { Timestamp } from 'firebase-admin/firestore';
import type { ProductionEntry, GarmentStyle, User, Configuration } from '@/lib/types';
import { calculateMonthlyEfficiency, calculateWorkedMinutes } from './calculations';

// Helper to get the start of a given date (in the server's timezone)
const getStartOfDay = (date: Date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return Timestamp.fromDate(start);
};

// Helper to get the end of a given date (in the server's timezone)
const getEndOfDay = (date: Date) => {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return Timestamp.fromDate(end);
};

// A consolidated function to calculate stats for a given date range
async function calculateStatsForPeriod(operatorId: string, startDate: Timestamp, endDate: Timestamp) {
    if (!firestore) throw new Error("Firestore not initialized");

    const productionQuery = firestore.collection('production')
        .where('operatorId', '==', operatorId)
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate);

    const productionSnapshot = await productionQuery.get();
    const productions = productionSnapshot.docs.map(doc => doc.data() as ProductionEntry);

    const styleIds = [...new Set(productions.map(p => p.styleId))].filter(id => id);
    const styles: GarmentStyle[] = [];
    if (styleIds.length > 0) {
        const stylesQuery = firestore.collection('styles').where('__name__', 'in', styleIds);
        const stylesSnapshot = await stylesQuery.get();
        stylesSnapshot.forEach(doc => styles.push({ id: doc.id, ...doc.data() } as GarmentStyle));
    }

    const allOperations = styles.flatMap(s => s.operations || []);
    const earnedMinutesByStyle: { [key: string]: number } = {};

    let totalEarnedMinutes = 0;
    let totalOperations = 0;
    let totalRework = 0;
    const workedDays = new Set<string>();

    for (const entry of productions) {
        const operation = allOperations.find(op => op.id === entry.operationId);
        if (operation && operation.smv) {
            const smvInSeconds = operation.smv;
            const earnedMinutesForEntry = (entry.cumulativeQuantity || 0) * (smvInSeconds / 60);
            totalEarnedMinutes += earnedMinutesForEntry;
            earnedMinutesByStyle[entry.styleId] = (earnedMinutesByStyle[entry.styleId] || 0) + earnedMinutesForEntry;
        }
        totalOperations += entry.cumulativeQuantity || 0;
        totalRework += entry.reworkQuantity || 0;
        workedDays.add(entry.timestamp.toDate().toISOString().split('T')[0]);
    }

    let equivalentGarments = 0;
    for (const styleId in earnedMinutesByStyle) {
        const style = styles.find(s => s.id === styleId);
        const totalSmvSeconds = style?.operations.reduce((sum, op) => sum + (Number(op.smv) || 0), 0) || style?.totalSmv || 0;

        if (totalSmvSeconds > 0) {
            const totalSmvMinutes = totalSmvSeconds / 60;
            equivalentGarments += earnedMinutesByStyle[styleId] / totalSmvMinutes;
        }
    }

    return { totalEarnedMinutes, totalOperations, totalRework, equivalentGarments, workedDays };
}

export async function updateOperatorStats(operatorId: string, entryDate: Date) {
    if (!firestore) throw new Error("Firestore is not initialized");

    // Fetch Global Configuration
    const configSnapshot = await firestore.collection('configuration').limit(1).get();
    if (configSnapshot.empty) {
        throw new Error("Configuration not found");
    }
    const config = configSnapshot.docs[0].data() as Configuration;
    const availableMinutesPerDay = config.availableMinutesPerDay;

    // --- 1. ALWAYS UPDATE TODAY'S STATS ---
    const today = new Date(); // Server's current date
    const startOfToday = getStartOfDay(today);
    const endOfToday = getEndOfDay(today);
    const todayStats = await calculateStatsForPeriod(operatorId, startOfToday, endOfToday);
    const todayEfficiency = availableMinutesPerDay > 0 ? (todayStats.totalEarnedMinutes / availableMinutesPerDay) * 100 : 0;

    // --- 2. ALWAYS UPDATE THE MONTHLY STATS FOR THE ENTRY DATE'S MONTH ---
    const startOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth(), 1);
    const endOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const monthStats = await calculateStatsForPeriod(operatorId, Timestamp.fromDate(startOfMonth), Timestamp.fromDate(endOfMonth));
    const totalWorkedMinutesInMonth = calculateWorkedMinutes(monthStats.workedDays.size, config);
    const monthlyEfficiency = calculateMonthlyEfficiency(monthStats.totalEarnedMinutes, totalWorkedMinutesInMonth);

    // --- 3. PREPARE AND WRITE THE FIRESTORE DOCUMENT ---
    const operatorRef = firestore.collection('users').doc(operatorId);
    const operatorDoc = await operatorRef.get();
    const operatorData = operatorDoc.data() as User || {};
    const monthKey = `${entryDate.getFullYear()}-${(entryDate.getMonth() + 1).toString().padStart(2, '0')}`;

    const dataToUpdate: Partial<User> & { [key: string]: any } = {
        // Update top-level fields with TODAY's data
        earnedMinutes: todayStats.totalEarnedMinutes,
        totalOperations: todayStats.totalOperations,
        rework: todayStats.totalRework,
        equivalentGarments: todayStats.equivalentGarments,
        efficiency: Math.round(todayEfficiency),
        // Update the monthly stats object
        monthlyStats: {
            ...(operatorData.monthlyStats || {}),
            [monthKey]: {
                totalEarnedMinutes: monthStats.totalEarnedMinutes,
                daysWorked: monthStats.workedDays.size,
                monthlyEfficiency: Math.round(monthlyEfficiency),
                equivalentGarments: monthStats.equivalentGarments,
            },
        },
    };

    await operatorRef.set(dataToUpdate, { merge: true });

    return { success: true };
}
