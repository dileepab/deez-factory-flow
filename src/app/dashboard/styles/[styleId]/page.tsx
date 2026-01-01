'use client';

import { useState, use } from 'react';
import { notFound } from 'next/navigation';
import { useDoc } from '@/firebase/firestore/use-doc';
import { doc, runTransaction } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { Loader } from '@/components/loader';
import type { GarmentStyle, GarmentOperation } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { MACHINE_TYPES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { MultiSelect, Option } from '@/components/ui/multi-select';

export default function StyleDetailPage({ params }: { params: Promise<{ styleId: string }> }) {
  const { styleId } = use(params);
  const styleRef = useMemoFirebase(
    () => doc(firestore, 'styles', styleId),
    [styleId]
  );
  const { data: style, isLoading, error } = useDoc<GarmentStyle>(styleRef);

  const [newOperation, setNewOperation] = useState('');
  const [newOperationTime, setNewOperationTime] = useState('');
  const [newMachineType, setNewMachineType] = useState<typeof MACHINE_TYPES[number] | ''>( '');
  const [newDependencies, setNewDependencies] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingOperation, setEditingOperation] = useState<{ op: GarmentOperation; index: number } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const resetForm = () => {
    setNewOperation('');
    setNewOperationTime('');
    setNewMachineType('');
    setNewDependencies([]);
  }

  const handleAddOperation = async () => {
    if (newOperation.trim() === '' || newOperationTime.trim() === '' || newMachineType === '') {
      return;
    }

    setIsAdding(true);
    try {
      await runTransaction(firestore, async (transaction) => {
        const styleDoc = await transaction.get(styleRef);
        if (!styleDoc.exists()) {
          throw "Document does not exist!";
        }

        const currentStyle = styleDoc.data() as GarmentStyle;
        const currentOperations = currentStyle.operations || [];
        const newOperationData: GarmentOperation = { 
          id: nanoid(),
          name: newOperation, 
          smv: parseInt(newOperationTime, 10), 
          machineType: newMachineType, 
          dependencies: newDependencies,
          completedQuantity: 0
        };

        const newOperations = [...currentOperations, newOperationData];
        const totalSmvInSeconds = newOperations.reduce((sum, op: GarmentOperation) => sum + op.smv, 0);
        const newTotalSmv = totalSmvInSeconds / 60; // Convert to minutes

        transaction.update(styleRef, {
          operations: newOperations,
          totalSmv: newTotalSmv
        });
      });

      resetForm();
    } catch (err) {
      console.error('Error adding operation:', err);
    } finally {
      setIsAdding(false);
    }
  };

  const handleStartEdit = (op: GarmentOperation, index: number) => {
    setEditingOperation({ op, index });
    setNewOperation(op.name);
    setNewOperationTime(String(op.smv));
    setNewMachineType(op.machineType);
    setNewDependencies(op.dependencies || []);
  };

  const handleCancelEdit = () => {
    setEditingOperation(null);
    resetForm();
  };

  const handleUpdateOperation = async () => {
    if (!editingOperation || newOperation.trim() === '' || newOperationTime.trim() === '' || newMachineType === '') {
      return;
    }

    setIsUpdating(true);
    try {
      await runTransaction(firestore, async (transaction) => {
        const styleDoc = await transaction.get(styleRef);
        if (!styleDoc.exists()) {
          throw "Document does not exist!";
        }

        const currentStyle = styleDoc.data() as GarmentStyle;
        const currentOperations = currentStyle.operations || [];
        
        const updatedOperation: GarmentOperation = {
          ...editingOperation.op,
          name: newOperation,
          smv: parseInt(newOperationTime, 10),
          machineType: newMachineType,
          dependencies: newDependencies
        };

        const newOperations = [...currentOperations];
        newOperations[editingOperation.index] = updatedOperation;

        const totalSmvInSeconds = newOperations.reduce((sum, op: GarmentOperation) => sum + op.smv, 0);
        const newTotalSmv = totalSmvInSeconds / 60; // Convert to minutes

        transaction.update(styleRef, {
          operations: newOperations,
          totalSmv: newTotalSmv
        });
      });
      handleCancelEdit();
    } catch (err) {
      console.error('Error updating operation:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemoveOperation = async (operationToRemove: GarmentOperation) => {
    try {
      await runTransaction(firestore, async (transaction) => {
        const styleDoc = await transaction.get(styleRef);
        if (!styleDoc.exists()) {
          throw "Document does not exist!";
        }

        const currentStyle = styleDoc.data() as GarmentStyle;
        const currentOperations = currentStyle.operations || [];
        
        const indexToRemove = currentOperations.findIndex(
          (op: GarmentOperation) => op.id === operationToRemove.id
        );
        
        if (indexToRemove === -1) {
          return;
        }

        const newOperations = [...currentOperations];
        newOperations.splice(indexToRemove, 1);
        
        // Also remove this operation from any other operations' dependencies
        newOperations.forEach((op: GarmentOperation) => {
          if (op.dependencies) {
            const depIndex = op.dependencies.indexOf(operationToRemove.id);
            if (depIndex !== -1) {
              op.dependencies.splice(depIndex, 1);
            }
          }
        });

        const totalSmvInSeconds = newOperations.reduce((sum, op: GarmentOperation) => sum + op.smv, 0);
        const newTotalSmv = totalSmvInSeconds / 60; // Convert to minutes

        transaction.update(styleRef, {
          operations: newOperations,
          totalSmv: newTotalSmv
        });
      });
    } catch (err) {
      console.error('Error removing operation:', err);
    }
  };

  const isProcessing = isAdding || isUpdating;

  const operationOptions: Option[] = style?.operations.map((op: GarmentOperation) => ({ value: op.id, label: op.name })) || [];

  if (isLoading) {
    return <Loader />;
  }

  if (error || !style) {
    return notFound();
  }

  return (
    <div>
      <PageHeader title={`Style: ${style.name}`} />

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{editingOperation ? 'Edit Operation' : 'Add New Operation'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <Input
              type="text"
              placeholder="Operation Name"
              value={newOperation}
              onChange={(e) => setNewOperation(e.target.value)}
              className="flex-grow"
              disabled={isProcessing}
            />
            <Input
              type="number"
              placeholder="Time (seconds)"
              value={newOperationTime}
              onChange={(e) => setNewOperationTime(e.target.value)}
              className="w-full sm:w-auto"
              disabled={isProcessing}
            />
            <Select 
              value={newMachineType} 
              onValueChange={(value) => setNewMachineType(value as typeof MACHINE_TYPES[number])}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-full sm:w-[280px]">
                <SelectValue placeholder="Select Machine Type" />
              </SelectTrigger>
              <SelectContent>
                {MACHINE_TYPES.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mb-4">
            <MultiSelect
                options={operationOptions.filter(op => editingOperation ? op.value !== editingOperation.op.id : true)}
                selected={newDependencies}
                onChange={setNewDependencies}
                placeholder="Select Dependencies"
                className="w-full"
              />
          </div>
          
          {editingOperation ? (
            <div className="flex w-full sm:w-auto sm:gap-2">
              <Button onClick={handleUpdateOperation} className="w-full" disabled={isProcessing}>
                <span className="flex items-center justify-center">
                  {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </span>
              </Button>
              <Button variant="outline" onClick={handleCancelEdit} className="w-full mt-2 sm:mt-0" disabled={isProcessing}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={handleAddOperation} className="w-full sm:w-auto" disabled={isProcessing}>
              {isAdding ? (
                <span className="flex items-center justify-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </span>
              ) : 'Add Operation'}
            </Button>
          )}

          <ul className="space-y-2 mt-6">
            {(style.operations || []).map((op: GarmentOperation, index: number) => (
              <li key={op.id} className="flex items-center justify-between p-3 bg-gray-100 rounded-md dark:bg-gray-800">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
                  <span className="font-semibold">{op.name}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{op.smv}s</span>
                  <Badge variant="outline">{op.machineType}</Badge>
                  {op.dependencies && op.dependencies.length > 0 && (
                    <div className="flex items-center gap-2 mt-2 sm:mt-0">
                      <span className="text-sm font-semibold">Depends on:</span>
                      <div className="flex flex-wrap gap-1">
                        {op.dependencies.map((depId: string) => {
                          const depOp = style.operations.find((o: GarmentOperation) => o.id === depId);
                          return depOp ? (
                            <Badge key={depId} variant="secondary">{depOp.name}</Badge>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleStartEdit(op, index)} disabled={isProcessing || editingOperation !== null}>
                    Edit
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleRemoveOperation(op)} disabled={isProcessing || editingOperation !== null}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
