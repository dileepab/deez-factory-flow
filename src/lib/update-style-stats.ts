import { firestore } from '@/firebase/server';
import type { ProductionEntry, GarmentStyle } from '@/lib/types';

/**
 * Recalculates the completion status for every operation within a specific GarmentStyle.
 * 
 * @param styleId The ID of the style to update.
 */
export async function updateStyleStats(styleId: string) {
    if (!firestore) {
        throw new Error("Firestore is not initialized.");
    }
    if (!styleId) {
        console.warn("updateStyleStats called without a styleId.");
        return;
    }

    // 1. Fetch the specific GarmentStyle document.
    const styleRef = firestore.collection('styles').doc(styleId);
    const styleDoc = await styleRef.get();

    if (!styleDoc.exists) {
        console.warn(`Style document with id ${styleId} does not exist.`);
        return;
    }

    const styleData = styleDoc.data() as GarmentStyle;

    // If the style has no defined operations, there's nothing to calculate.
    if (!styleData.operations || styleData.operations.length === 0) {
        return;
    }

    // 2. Fetch all production entries related to this style.
    const productionQuery = firestore.collection('production').where('styleId', '==', styleId);
    const productionSnapshot = await productionQuery.get();
    const productions = productionSnapshot.docs.map(doc => doc.data() as ProductionEntry);

    // 3. Aggregate the total produced quantity for each unique operation ID.
    const productionByOperation: { [key: string]: number } = {};
    for (const entry of productions) {
        if (entry.operationId) {
            productionByOperation[entry.operationId] = (productionByOperation[entry.operationId] || 0) + (entry.cumulativeQuantity || 0);
        }
    }

    // 4. Create an updated list of operations with the new `completedQuantity`.
    // This ensures we don't modify the original data structure in place.
    const updatedOperations = styleData.operations.map(op => {
        const completedQuantity = productionByOperation[op.id] || 0;
        return {
            ...op,
            completedQuantity: completedQuantity,
        };
    });

    // 5. Atomically update the operations array in the style document.
    await styleRef.update({
        operations: updatedOperations
    });

    console.log(`Successfully updated stats for style: ${styleId}`);
    return { success: true, styleId: styleId };
}
