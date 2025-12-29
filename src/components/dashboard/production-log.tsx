'use client';

import { useState, useMemo } from 'react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, where, doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import type { ProductionEntry as ProductionEntryType, User, GarmentStyle } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Edit, Trash, Loader2, Calendar as CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface EnrichedProductionEntry extends ProductionEntryType {
  operatorName: string;
  operationName: string;
}

// Helper function to extract the start time from a range like "07:30 - 08:30"
const getStartTime = (range: string = '') => {
  if (!range) return '00:00';
  return range.split('-')[0].trim();
};

export function ProductionLog() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [entryToDelete, setEntryToDelete] = useState<EnrichedProductionEntry | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<EnrichedProductionEntry | null>(null);
  const [newQuantity, setNewQuantity] = useState<string>("");

  const productionQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);
    return query(
      collection(firestore, 'production'),
      where('timestamp', '>=', Timestamp.fromDate(startOfDay)),
      where('timestamp', '<=', Timestamp.fromDate(endOfDay))
      // We can no longer sort by timestamp, as we need to sort by the time range string.
    );
  }, [selectedDate]);

  const { data: productionEntries, isLoading: entriesLoading } = useCollection<ProductionEntryType>(productionQuery);
  const { data: operators, isLoading: operatorsLoading } = useCollection<User>(useMemoFirebase(() => firestore ? collection(firestore, 'users') : null, []));
  const { data: styles, isLoading: stylesLoading } = useCollection<GarmentStyle>(useMemoFirebase(() => firestore ? collection(firestore, 'styles') : null, []));

  const enrichedProductionEntries = useMemo<EnrichedProductionEntry[]>(() => {
    if (!productionEntries || !operators || !styles) return [];

    const allOperations = styles.flatMap(s => s.operations || []);

    const enriched = productionEntries.map(entry => {
      const operator = operators.find(op => op.id === entry.operatorId);
      const operation = allOperations.find(op => op.id === entry.operationId);
      return {
        ...entry,
        operatorName: operator?.name ?? 'Unknown Operator',
        operationName: operation?.name ?? 'Unknown Operation',
      };
    });

    // Sort the entries based on the start time of their hourlyRange.
    enriched.sort((a, b) => {
        const startTimeA = getStartTime(a.hourlyRange);
        const startTimeB = getStartTime(b.hourlyRange);
        return startTimeA.localeCompare(startTimeB);
    });

    return enriched;
  }, [productionEntries, operators, styles]);

  const isLoading = entriesLoading || operatorsLoading || stylesLoading;

  const triggerStatsUpdate = async (operatorId: string) => {
    try {
      const response = await fetch('/api/update-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId, date: selectedDate.toISOString() }),
      });
      if (!response.ok) throw new Error('Failed to trigger stats update');
      toast({ title: 'Stats Recalculated', description: "The operator's daily statistics have been updated." });
    } catch (error) {
      console.error('Error triggering stats update:', error);
      toast({ variant: 'destructive', title: 'Stat Update Failed', description: 'Could not recalculate operator stats.' });
    }
  };

  const handleDelete = async () => {
    if (!firestore || !entryToDelete) return;
    try {
      await deleteDoc(doc(firestore, 'production', entryToDelete.id));
      toast({ title: 'Entry Deleted', description: 'The production log has been removed.' });
      await triggerStatsUpdate(entryToDelete.operatorId);
    } catch (error) {
      console.error('Error deleting document: ', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not delete the entry.' });
    } finally {
      setEntryToDelete(null);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !entryToEdit) return;
    
    const quantity = parseInt(newQuantity, 10);
    if (isNaN(quantity) || quantity < 0) {
        toast({ variant: 'destructive', title: 'Invalid Input', description: 'Please enter a valid quantity.' });
        return;
    }

    try {
      const entryRef = doc(firestore, 'production', entryToEdit.id);
      await updateDoc(entryRef, { cumulativeQuantity: quantity });
      toast({ title: 'Entry Updated', description: 'The production quantity has been updated.' });
      await triggerStatsUpdate(entryToEdit.operatorId);
    } catch (error) {
      console.error('Error updating document: ', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update the entry.' });
    } finally {
      setEntryToEdit(null);
      setNewQuantity("");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
            <div>
                <CardTitle>Production Log</CardTitle>
                <CardDescription>View, edit, or delete production entries for the selected date.</CardDescription>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-[240px] justify-start text-left font-normal",
                    !selectedDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => setSelectedDate(date || new Date())}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time Range</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">
                     <div className="flex justify-center items-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                        Loading logs...
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && enrichedProductionEntries.length === 0 && (
                <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground h-24">
                        No production has been logged for {format(selectedDate, "PPP")}.
                    </TableCell>
                </TableRow>
              )}
              {!isLoading && enrichedProductionEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.hourlyRange || 'N/A'}</TableCell>
                  <TableCell>{entry.operatorName}</TableCell>
                  <TableCell>{entry.operationName}</TableCell>
                  <TableCell>{entry.cumulativeQuantity}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" className="mr-2" onClick={() => { setEntryToEdit(entry); setNewQuantity(String(entry.cumulativeQuantity)); }}>
                      <Edit className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setEntryToDelete(entry)}>
                      <Trash className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!entryToDelete} onOpenChange={() => setEntryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the production entry for <span className="font-bold">{entryToDelete?.operatorName}</span> on operation <span className="font-bold">{entryToDelete?.operationName}</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <Dialog open={!!entryToEdit} onOpenChange={() => { setEntryToEdit(null); setNewQuantity(""); }}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleEdit}>
            <DialogHeader>
              <DialogTitle>Edit Production Entry</DialogTitle>
                <DialogDescription>
                  Make changes to the production entry here. Click save when you're done.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="quantity" className="text-right">
                  New Quantity
                </Label>
                <Input
                  id="quantity"
                  type="number"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                  className="col-span-3"
                  required
                />
              </div>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="secondary">Cancel</Button>
                </DialogClose>
                <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
