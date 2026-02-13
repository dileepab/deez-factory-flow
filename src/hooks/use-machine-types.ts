import { useConfiguration } from '@/firebase/firestore/use-configuration';
import { MACHINE_TYPES } from '@/lib/constants';
import { useMemo } from 'react';

export function useMachineTypes() {
    const { data: config, isLoading } = useConfiguration();

    const allTypes = useMemo(() => {
        const custom = config?.customMachineTypes || [];
        // Combine and dedupe (just in case)
        return Array.from(new Set([...MACHINE_TYPES, ...custom]));
    }, [config?.customMachineTypes]);

    const machineCounts = useMemo(() => {
        return config?.machineCounts || {};
    }, [config?.machineCounts]);

    // Helper to get count with default fallback
    const getCount = (type: string) => {
        return machineCounts[type] ?? 5; // Default 5 if not set
    };

    return {
        allTypes,
        machineCounts,
        getCount,
        isLoading
    };
}
