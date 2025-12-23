'use client';

import { useState, use } from 'react';
import { notFound } from 'next/navigation';
import { useDoc } from '@/firebase/firestore/use-doc';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { Loader } from '@/components/loader';
import type { Style } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';

export default function StyleDetailPage({ params }: { params: Promise<{ styleId: string }> }) {
  const { styleId } = use(params);
  const styleRef = useMemoFirebase(
    () => doc(firestore, 'styles', styleId),
    [styleId]
  );
  const { data: style, isLoading, error } = useDoc<Style>(styleRef);

  const [newOperation, setNewOperation] = useState('');
  const [newOperationTime, setNewOperationTime] = useState('');

  const handleAddOperation = async () => {
    if (newOperation.trim() === '' || newOperationTime.trim() === '') {
      return;
    }

    const newOperationData = { name: newOperation, time: parseInt(newOperationTime, 10) };
    const currentOperations = style?.operations || [];
    const newTotalSmv = [...currentOperations, newOperationData].reduce((sum, op) => sum + op.time, 0);

    try {
      await updateDoc(styleRef, {
        operations: arrayUnion(newOperationData),
        totalSmv: newTotalSmv,
      });
      setNewOperation('');
      setNewOperationTime('');
    } catch (err) {
      console.error('Error adding operation:', err);
    }
  };

  const handleRemoveOperation = async (operation: { name: string; time: number }) => {
    const currentOperations = style?.operations || [];
    const updatedOperations = currentOperations.filter(op => op.name !== operation.name || op.time !== operation.time);
    const newTotalSmv = updatedOperations.reduce((sum, op) => sum + op.time, 0);

    try {
      await updateDoc(styleRef, {
        operations: arrayRemove(operation),
        totalSmv: newTotalSmv,
      });
    } catch (err) {
      console.error('Error removing operation:', err);
    }
  };


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
          <CardTitle>Manage Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <Input
              type="text"
              placeholder="New Operation Name"
              value={newOperation}
              onChange={(e) => setNewOperation(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Time (seconds)"
              value={newOperationTime}
              onChange={(e) => setNewOperationTime(e.target.value)}
            />
            <Button onClick={handleAddOperation}>Add Operation</Button>
          </div>

          <ul className="space-y-2">
            {(style.operations || []).map((op, index) => (
              <li key={index} className="flex items-center justify-between p-2 bg-gray-100 rounded-md dark:bg-gray-800">
                <span>{op.name} - {op.time}s</span>
                <Button variant="destructive" size="sm" onClick={() => handleRemoveOperation(op)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
