import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// IMPORTANT: Do not use this file in the client side of your app.
const serviceAccount = process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ? JSON.parse(process.env.FIREBASE_ADMIN_PRIVATE_KEY)
  : null;

if (getApps().length === 0) {
  initializeApp(
    serviceAccount
      ? {
          credential: cert(serviceAccount),
        }
      : undefined
  );
}

export const admin = {
  auth: getAuth,
  firestore: getFirestore,
};
