import { useMemo } from 'react';

export const useMemoFirebase = <T>(factory: () => T, deps: any[]): T => {
  const result = useMemo(factory, deps);

  // We can only add a property to an object.
  // This check ensures that we don't try to add a property to a primitive.
  if (typeof result === 'object' && result !== null) {
    (result as any).__memo = true;
  }

  return result;
};
