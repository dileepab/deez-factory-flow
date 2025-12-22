'use client';

import React, { useMemo, type ReactNode, useEffect, useState } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';
import { getCookie } from 'cookies-next';
import { signInWithCustomToken } from 'firebase/auth';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
    const [isTokenSigningIn, setIsTokenSigningIn] = useState(true);
  const firebaseServices = useMemo(() => {
    // Initialize Firebase on the client side, once per component mount.
    return initializeFirebase();
  }, []);

  useEffect(() => {
    const signInWithToken = async () => {
        const token = getCookie('custom-token');
        if (token && firebaseServices.auth.currentUser === null) {
            try {
                await signInWithCustomToken(firebaseServices.auth, token as string);
            } catch (error) {
                console.error("Failed to sign in with custom token", error);
            }
        }
        setIsTokenSigningIn(false);
    };
    signInWithToken();
  }, [firebaseServices.auth]);

  if(isTokenSigningIn) {
    return <div>Authenticating...</div>
  }

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}
