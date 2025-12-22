
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { PlusCircle, Loader2 } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, addDoc, setDoc, doc } from 'firebase/firestore';
import type { Operator } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { OPERATORS } from '@/lib/data';

export function OperatorManagement() {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const operatorsQuery = useMemoFirebase(
    () => (firestore ? collection(firestore, 'operators') : null),
    [firestore]
  );
  const { data: operators, isLoading: operatorsLoading } =
    useCollection<Operator>(operatorsQuery);
  const [open, setOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  // Seed initial data if the collection is empty
  useEffect(() => {
    if (firestore && operators?.length === 0 && !operatorsLoading) {
      handleSeedData();
    }
  }, [firestore, operators, operatorsLoading]);

  const handleSeedData = async () => {
    if (!firestore) return;
    setIsSeeding(true);
    toast({
      title: 'Seeding Data',
      description: 'Adding initial operators to the database...',
    });

    try {
      for (const operator of OPERATORS) {
        // Use the id from mock data as the document ID
        const operatorRef = doc(firestore, 'operators', operator.id);
        await setDoc(operatorRef, operator);
      }
      toast({
        title: 'Seeding Complete',
        description: 'Initial operators have been added.',
      });
    } catch (error) {
      console.error('Error seeding operators: ', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to seed operators. Please try again.',
      });
    } finally {
      setIsSeeding(false);
    }
  };


  const handleAddOperator = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore) return;

    const formData = new FormData(e.currentTarget);
    const newOperator = {
      id: `op-${Math.random().toString(36).substring(2, 9)}`, // Generate a random ID
      name: formData.get('operatorName') as string,
      targetSalary: parseFloat(formData.get('targetSalary') as string),
      attendanceBonus: parseFloat(formData.get('attendanceBonus') as string),
      avatarUrl: `https://picsum.photos/seed/${Math.random()}/40/40`,
      efficiency: 0,
      earnedMinutes: 0,
      totalProduction: 0,
      rework: 0,
    };

    try {
      const docRef = doc(firestore, 'operators', newOperator.id);
      await setDoc(docRef, newOperator);
      toast({
        title: 'Operator Added',
        description: `Successfully added operator "${newOperator.name}".`,
      });
      setOpen(false);
    } catch (error) {
      console.error('Error adding operator: ', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add operator. Please try again.',
      });
    }
  };

  return (
    <Card id="operators">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Operator Management</CardTitle>
          <CardDescription>View, add, or manage operators.</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Operator
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Operator</DialogTitle>
              <DialogDescription>
                Enter the details for the new operator. Performance data will be
                calculated automatically.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddOperator} className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="operatorName" className="text-right">
                  Name
                </Label>
                <Input
                  id="operatorName"
                  name="operatorName"
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="targetSalary" className="text-right">
                  Target Salary
                </Label>
                <Input
                  id="targetSalary"
                  name="targetSalary"
                  type="number"
                  defaultValue="50000"
                  className="col-span-3"
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="attendanceBonus" className="text-right">
                  Attendance Bonus
                </Label>
                <Input
                  id="attendanceBonus"
                  name="attendanceBonus"
                  type="number"
                  defaultValue="5000"
                  className="col-span-3"
                  required
                />
              </div>
              <Button type="submit">Add Operator</Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Target Salary</TableHead>
              <TableHead className="text-right">Attendance Bonus</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(operatorsLoading || isSeeding) && (
              <TableRow>
                <TableCell colSpan={3} className="text-center">
                  <div className="flex justify-center items-center">
                   <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                   {isSeeding ? 'Seeding initial data...' : 'Loading operators...'}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {operators?.map(operator => (
              <TableRow key={operator.id}>
                <TableCell className="font-medium">{operator.name}</TableCell>
                <TableCell>{operator.targetSalary}</TableCell>
                <TableCell className="text-right">
                  {operator.attendanceBonus}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
