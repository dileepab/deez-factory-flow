import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

// Initialize Firebase
const apps = getApps();
if (!apps.length) {
  initializeApp(firebaseConfig);
}

export const auth = getAuth();
export const firestore = getFirestore();
