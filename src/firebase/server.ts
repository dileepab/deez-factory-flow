import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// Check if the app is already initialized to prevent errors
if (!getApps().length) {
  try {
    // The service account key provides all the necessary configuration
    initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!)),
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error("Error initializing Firebase Admin SDK:", error);
    // If initialization fails, you might want to handle it gracefully
    // For now, we'll log the error and subsequent operations will likely fail.
  }
}

// Export firestore and auth instances
const firestore = getFirestore();
const auth = getAuth();

export { firestore, auth };
