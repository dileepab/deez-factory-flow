'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, firestore } from '@/firebase/client';
import { sessionLogin, sessionLogout } from '@/lib/actions';
import { usePathname, useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: (name: string, email: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signUp: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const handleAuthStateChanged = useCallback(async (user: User | null) => {
    setUser(user);
    if (user) {
      try {
        const idToken = await user.getIdToken(true);
        await sessionLogin(idToken);
      } catch (error) {
        console.error('Failed to set session cookie:', error);
      }
    } else {
      await sessionLogout();
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, handleAuthStateChanged);
    return () => unsubscribe();
  }, [handleAuthStateChanged]);

  useEffect(() => {
    if (loading) return;

    const isAuthPage = pathname === '/' || pathname === '/signup';

    if (user && isAuthPage) {
      router.push('/dashboard');
    } else if (!user && pathname.startsWith('/dashboard')) {
      router.push('/');
    }
  }, [user, loading, pathname, router]);

  const signUp = async (name: string, email: string, password: string) => {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = userCredential.user;

    await updateProfile(user, { displayName: name });

    const userRef = doc(firestore, 'users', user.uid);
    await setDoc(userRef, {
      id: user.uid,
      name,
      email,
      role: 'operator', 
      avatarUrl: '', 
      efficiency: 0,
      earnedMinutes: 0,
      totalProduction: 0,
      rework: 0,
      targetSalary: 0,
      attendanceBonus: 0,
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
