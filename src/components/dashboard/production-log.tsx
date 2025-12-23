'use client';

import { useState } from 'react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, orderBy, where, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ProductionEntry as ProductionEntryType } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Edit, Trash } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Helper to get start of day
const getStartOfDay = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
};

export function ProductionLog() {
  const { toast } = useToast();
  const [startOfDay] = useState(getStartOfDay());

  const productionQuery = useMemoFirebase(
    () =>
      firestore
        ? query(
            collection(firestore, 'production'),
            where('timestamp', '>=', startOfDay),
            orderBy('timestamp', 'desc')
          )
        : null,
    [startOfDay]
  );

  const { data: productionEntries, isLoading } = useCollection<ProductionEntryType>(productionQuery);

  const handleDelete = async (id: string) => {
    if (!firestore) return;
    if (confirm('Are you sure you want to delete this entry?')) {
      try {
        await deleteDoc(doc(firestore, 'production', id));
        toast({ title: 'Entry Deleted', description: 'The production log has been removed.' });
      } catch (error) {
        console.error('Error deleting document: ', error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not delete the entry.' });
      }
    }
  };

  // Basic edit functionality for now
  const handleEdit = async (entry: ProductionEntryType) => {
    if (!firestore) return;
    const newQuantity = prompt('Enter new cumulative quantity:', String(entry.cumulativeQuantity));
    if (newQuantity !== null) {
      const quantity = parseInt(newQuantity, 10);
      if (!isNaN(quantity) && quantity >= 0) {
        try {
          const entryRef = doc(firestore, 'production', entry.id);
          await updateDoc(entryRef, { cumulativeQuantity: quantity });
          toast({ title: 'Entry Updated', description: 'The production quantity has been updated.' });
        } catch (error) {
          console.error('Error updating document: ', error);
          toast({ variant: 'destructive', title: 'Error', description: 'Could not update the entry.' });
        }
      }
    }
  };

  if (isLoading) {
    return <div>Loading production logs...</div>;
  }

  if (!productionEntries || productionEntries.length === 0) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Today&apos;s Production Log</CardTitle>
            </CardHeader>
            <CardContent>
                <p>No production has been logged yet for today.</p>
            </CardContent>
        </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s Production Log</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Hourly Range</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {productionEntries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{entry.timestamp ? new Date(entry.timestamp.seconds * 1000).toLocaleTimeString() : 'N/A'}</TableCell>
                <TableCell>{entry.operatorName}</TableCell>
                <TableCell>{entry.operationName}</TableCell>
                <TableCell>{entry.hourlyRange}</TableCell>
                <TableCell>{entry.cumulativeQuantity}</TableCell>
                <TableCell className="space-x-2">
                  <Button variant="outline" size="icon" onClick={() => handleEdit(entry)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="destructive" size="icon" onClick={() => handleDelete(entry.id)}>
                    <Trash className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
