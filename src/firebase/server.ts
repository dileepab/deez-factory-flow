import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";

let app;
let firestore: Firestore;
let auth: Auth;

// This pattern ensures that we initialize the app only once.
if (!getApps().length) {
  // The service account key is stored in a base64-encoded environment variable.
  const serviceAccountKeyBase64 = process.env.FIREBASE_CREDENTIALS_BASE64;

  if (!serviceAccountKeyBase64) {
    throw new Error('CRITICAL: The FIREBASE_CREDENTIALS_BASE64 environment variable is not set. The server cannot start without it.');
  }

  try {
    // Decode the base64 string to get the JSON string.
    const serviceAccountJson = Buffer.from(serviceAccountKeyBase64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(serviceAccountJson);

    app = initializeApp({
      credential: cert(serviceAccount),
    });

    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error: any) {
    // Log the original error for detailed debugging.
    console.error(
      "CRITICAL: Error initializing Firebase Admin SDK. This is often due to an invalid or malformed FIREBASE_CREDENTIALS_BASE64 environment variable. Ensure it is a valid base64-encoded service account key. See the error details below:",
      error
    );
    // Throw a more informative error to the caller.
    throw new Error("Failed to initialize Firebase Admin SDK. Check server logs for the detailed error message.");
  }
} else {
  // If the app is already initialized, get the existing instance.
  app = getApp();
}

// Get the Firestore and Auth instances from the initialized app.
firestore = getFirestore(app);
auth = getAuth(app);

export { firestore, auth };
