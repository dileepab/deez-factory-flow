import { firestore } from '../firebase/server';
import { FieldValue } from 'firebase-admin/firestore';

console.log('Starting database cleaning script...');

// Helper function to delete all documents in a collection in batches
async function deleteCollection(collectionPath: string, batchSize: number) {
  const collectionRef = firestore.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query: FirebaseFirestore.Query, resolve: (value?: unknown) => void) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    // When there are no documents left, we are done
    resolve();
    return;
  }

  // Delete documents in a batch
  const batch = firestore.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // Recurse on the next process tick, to avoid hitting stack limits
  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}

async function cleanDatabase() {
  if (!firestore) {
    console.error('Firestore is not initialized. Make sure you have set up your service account credentials.');
    process.exit(1);
  }

  try {
    // 1. Delete all documents from the 'production' collection
    console.log("Deleting all documents from the 'production' collection...");
    await deleteCollection('production', 500);
    console.log("✅ 'production' collection has been cleared.");

    // 2. Clean up old fields from operator documents
    console.log("Cleaning up old fields from 'operator' documents...");
    const operatorsSnapshot = await firestore.collection('users').where('role', '==', 'operator').get();
    
    if (operatorsSnapshot.empty) {
      console.log("No operators found to clean.");
    } else {
      const batch = firestore.batch();
      operatorsSnapshot.docs.forEach(doc => {
        console.log(`- Scheduling cleanup for operator: ${doc.id}`);
        batch.update(doc.ref, {
          dailyProductions: FieldValue.delete(),
          efficiency: FieldValue.delete(),
          earnedMinutes: FieldValue.delete(),
          totalOperations: FieldValue.delete(),
          equivalentGarments: FieldValue.delete(),
          rework: FieldValue.delete(),
          reworkRate: FieldValue.delete(),
          attendance: FieldValue.delete()
        });
      });
      await batch.commit();
      console.log(`✅ Cleaned up ${operatorsSnapshot.size} operator document(s).`);
    }

    console.log('\nDatabase cleaning complete! You can now test from scratch.');

  } catch (error) {
    console.error('\nAn error occurred during the cleaning process:', error);
    process.exit(1);
  }
}

// Run the cleaning script
cleanDatabase().then(() => {
  console.log('Script finished successfully.');
  process.exit(0);
});