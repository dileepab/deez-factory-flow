import { initializeApp, getApps, getApp, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";

let app: App;
let firestore: Firestore;
let auth: Auth;

function initFirebase() {
  if (getApps().length) {
    app = getApp();
    firestore = getFirestore(app);
    auth = getAuth(app);
    return;
  }

  const serviceAccountKeyBase64 = process.env.SERVICE_ACCOUNT_KEY_BASE64;
  if (!serviceAccountKeyBase64) {
    throw new Error('CRITICAL: The SERVICE_ACCOUNT_KEY_BASE64 environment variable is not set. The server cannot start without it.');
  }

  try {
    let serviceAccountJson = Buffer.from(serviceAccountKeyBase64, 'base64').toString('utf8');
    serviceAccountJson = serviceAccountJson.replace(/[\n\r]/g, '');
    const serviceAccount = JSON.parse(serviceAccountJson);

    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      const header = "-----BEGIN PRIVATE KEY-----";
      const footer = "-----END PRIVATE KEY-----";
      if (!serviceAccount.private_key.includes(header + '\n')) {
        serviceAccount.private_key = serviceAccount.private_key.replace(header, header + '\n');
      }
      if (!serviceAccount.private_key.includes('\n' + footer)) {
        serviceAccount.private_key = serviceAccount.private_key.replace(footer, '\n' + footer);
      }
    }

    app = initializeApp({
      credential: cert(serviceAccount),
    });
    console.log("Firebase Admin SDK initialized successfully.");
  } catch (error) {
    console.error("CRITICAL: Error initializing Firebase Admin SDK:", error);
    throw new Error("Failed to initialize Firebase Admin SDK. See logs for details.");
  }

  firestore = getFirestore(app);
  auth = getAuth(app);
}

// In Next.js SSR, modules might be evaluated multiple times or in parallel contexts.
// We force initialization on module load.
try {
  initFirebase();
} catch (e) {
  console.error("Module-level initialization failed:", e);
  // Continue; runtime will likely fail later if app is used, but we logged the real error.
}

export { firestore, auth };
