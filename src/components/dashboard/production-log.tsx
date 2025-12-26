'use client';

import { useState } from 'react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, orderBy, where, doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { ProductionEntry as ProductionEntryType } from '@/lib/types';
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

export function ProductionLog() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [entryToDelete, setEntryToDelete] = useState<ProductionEntryType | null>(null);
  const [entryToEdit, setEntryToEdit] = useState<ProductionEntryType | null>(null);
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
      where('timestamp', '<=', Timestamp.fromDate(endOfDay)),
      orderBy('timestamp', 'desc')
    );
  }, [selectedDate]);

  const { data: productionEntries, isLoading } = useCollection<ProductionEntryType>(productionQuery);

  // Helper function to trigger stat recalculation
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
      // Trigger stats update after deleting
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
      // Trigger stats update after editing
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
                <TableHead>Time</TableHead>
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
              {!isLoading && (!productionEntries || productionEntries.length === 0) && (
                <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground h-24">
                        No production has been logged for {format(selectedDate, "PPP")}.
                    </TableCell>
                </TableRow>
              )}
              {!isLoading && productionEntries && productionEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.timestamp ? new Date(entry.timestamp.seconds * 1000).toLocaleTimeString() : 'N/A'}</TableCell>
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
