'use client';

import { useDoc } from "./use-doc";
import { doc } from "firebase/firestore";
import { firestore } from "@/firebase/client";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import type { Configuration } from "@/lib/types";

/**
 * A hook to fetch the main application configuration from Firestore.
 *
 * This provides a real-time subscription to the singleton configuration
 * document located at `configuration/main`.
 *
 * @returns The same interface as `useDoc`, containing the configuration
 * data, loading state, and any errors.
 */
export function useConfiguration() {
  // Memoize the document reference to prevent unnecessary re-renders.
  const configRef = useMemoFirebase(
    () => (firestore ? doc(firestore, "configuration", "main") : null),
    []
  );

  return useDoc<Configuration>(configRef);
}
