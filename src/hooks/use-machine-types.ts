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

    const machineThreadBallsPerMachine = useMemo(() => {
        return config?.machineThreadBallsPerMachine || {};
    }, [config?.machineThreadBallsPerMachine]);

    // Helper to get count with default fallback
    const getCount = (type: string) => {
        return machineCounts[type] ?? 5; // Default 5 if not set
    };

    const getThreadBallsPerMachine = (type: string) => {
        const configured = machineThreadBallsPerMachine[type];
        if (typeof configured === 'number' && isFinite(configured)) {
            return Math.max(1, Math.floor(configured));
        }
        return type.trim() === 'Overlock/Serger' ? 5 : 1;
    };

    return {
        allTypes,
        machineCounts,
        machineThreadBallsPerMachine,
        getCount,
        getThreadBallsPerMachine,
        isLoading
    };
}
