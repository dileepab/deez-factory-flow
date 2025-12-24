'use client';

import { useMemo } from 'react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, where } from 'firebase/firestore';
import { GarmentStyle, ProductionEntry } from '@/lib/types';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';

interface StyleProgressProps {
  style: GarmentStyle;
}

export function StyleProgress({ style }: StyleProgressProps) {
  const productionQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(
      collection(firestore, 'production'),
      where('styleId', '==', style.id)
    );
  }, [style.id]);

  const { data: productionEntries, isLoading } = useCollection<ProductionEntry>(productionQuery);

    const { equivalentProducedQuantity, targetQuantity } = useMemo(() => {
        const target = style.quantity || 0;
        if (!productionEntries || !style.operations || style.operations.length === 0 || !style.totalSmv || style.totalSmv === 0) {
        return { equivalentProducedQuantity: 0, targetQuantity: target };
        }

        const producedSmvInMinutes = productionEntries.reduce((sum, entry) => {
            const operation = style.operations.find(op => op.id === entry.operationId);
            if (!operation) return sum;

            const smvInSeconds = typeof operation.time === 'string' ? parseFloat(operation.time) : operation.time;
            if (isNaN(smvInSeconds)) return sum;

            const earnedMinutes = (entry.cumulativeQuantity || 0) * (smvInSeconds / 60);
            return sum + earnedMinutes;
        }, 0);

        // Convert total produced SMV back to an "equivalent" number of units
        const equivalentQuantity = producedSmvInMinutes / style.totalSmv;

        return { equivalentProducedQuantity: equivalentQuantity, targetQuantity: target };
    }, [productionEntries, style]);

    const completionPercentage = targetQuantity > 0 ? (equivalentProducedQuantity / targetQuantity) * 100 : 0;

  if (isLoading) {
    return (
      <div className="flex items-center">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium">
          {equivalentProducedQuantity.toFixed(0)} / {targetQuantity} units
        </span>
        <span className="text-sm font-bold">
          {completionPercentage.toFixed(2)}%
        </span>
      </div>
      <Progress value={completionPercentage} />
    </div>
  );
}
