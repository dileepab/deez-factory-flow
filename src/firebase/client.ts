import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore, 
  persistentLocalCache, 
  Firestore
} from 'firebase/firestore';
import { firebaseConfig } from './config';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let firestore: Firestore;

// Initialize Firestore with offline persistence.
// This must be done before any other Firestore operations.
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({}),
  });
} catch (error: any) {
  if (error.code === 'failed-precondition') {
    // This error happens if multiple tabs are open and persistence is enabled in another tab.
    console.warn(
      'Firestore persistence failed to initialize in this tab. This is likely because it is already active in another tab.'
    );
    // In this case, we can just get the regular Firestore instance for this tab.
    // It will sync with the primary tab through the backend.
    firestore = getFirestore(app);
  } else if (error.code === 'unimplemented') {
    // The current browser does not support all of the features required for persistence.
    console.warn(
      'The current browser does not support all of the features required for offline persistence.'
    );
    firestore = getFirestore(app);
  } else {
    // Rethrow any other errors.
    throw error;
  }
}

const auth = getAuth(app);

export { auth, firestore };
