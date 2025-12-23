import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// IMPORTANT: Do not use this file in the client side of your app.

const credentialsBase64 = process.env.FIREBASE_CREDENTIALS_BASE64;

if (!credentialsBase64) {
  throw new Error('The FIREBASE_CREDENTIALS_BASE64 environment variable is not set.');
}

// Decode the Base64 string into a JSON string
const credentialsJson = Buffer.from(credentialsBase64, 'base64').toString('utf8');
const serviceAccount: ServiceAccount = JSON.parse(credentialsJson);

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export const auth = getAuth();
export const db = getFirestore();
