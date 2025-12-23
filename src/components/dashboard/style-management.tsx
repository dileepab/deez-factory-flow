'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

import { Badge } from '@/components/ui/badge';
import { PlusCircle, Loader2, RefreshCw } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import type { GarmentStyle } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { GARMENT_STYLES } from '@/lib/data';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';

export function StyleManagement() {
  const { toast } = useToast();
  const stylesQuery = useMemoFirebase(
    () => (collection(firestore, 'styles')),
    []
  );
  const { data: styles, isLoading: stylesLoading } =
    useCollection<GarmentStyle>(stylesQuery);
  const [open, setOpen] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedAttempted, setSeedAttempted] = useState(false);

  useEffect(() => {
    if (styles?.length === 0 && !stylesLoading && !seedAttempted) {
      setSeedAttempted(true);
      handleSeedData();
    }
  }, [styles, stylesLoading, seedAttempted]);

  const handleSeedData = async () => {
    if (!firestore) return;
    setIsSeeding(true);
    toast({
      title: 'Seeding Data',
      description: 'Adding initial garment styles to the database...',
    });
    try {
      for (const style of GARMENT_STYLES) {
        const totalSmv = style.operations.reduce((sum, op) => sum + op.time, 0);
        const correctedStyle = { ...style, totalSmv };

        const styleRef = doc(firestore, 'styles', style.id);
        await setDoc(styleRef, correctedStyle);
      }
      toast({
        title: 'Seeding Complete',
        description: 'Initial garment styles have been added.',
      });
    } catch (error) {
      console.error('Error seeding styles: ', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to seed styles. Please try again.',
      });
    } finally {
      setIsSeeding(false);
    }
  };

  const handleAddStyle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore) return;

    const formData = new FormData(e.currentTarget);
    const newStyle = {
      id: `style-${Math.random().toString(36).substring(2, 9)}`,
      name: formData.get('styleName') as string,
      totalSmv: 0,
      operations: [],
    };

    try {
      const docRef = doc(firestore, 'styles', newStyle.id);
      await setDoc(docRef, newStyle);
      toast({
        title: 'Style Added',
        description: `Successfully added style "${newStyle.name}".`,
      });
      setOpen(false);
    } catch (error) {
      console.error('Error adding style: ', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add style. Please try again.',
      });
    }
  };

  return (
    <Card id="styles">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Garment Style Management</CardTitle>
          <CardDescription>View, add, or manage garment styles.</CardDescription>
        </div>
        <div className="flex gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={isSeeding}>
              <RefreshCw className="mr-2 h-4 w-4" /> Re-seed Data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will wipe all existing styles and replace them with the initial seed data. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSeedData}>Continue</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" /> Add Style
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Add New Style</DialogTitle>
                <DialogDescription>
                  Enter the details for the new garment style.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddStyle} className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="styleName" className="text-right">
                    Style Name
                  </Label>
                  <Input
                    id="styleName"
                    name="styleName"
                    className="col-span-3"
                    required
                  />
                </div>
                <Button type="submit">Add Style</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Style Name</TableHead>
              <TableHead className="text-center">Operations</TableHead>
              <TableHead className="text-right">Total SMV</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(stylesLoading || isSeeding) && (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                 <div className="flex justify-center items-center">
                   <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                   {isSeeding ? 'Seeding initial data...' : 'Loading styles...'}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {styles?.map(style => (
              <TableRow key={style.id}>
                <TableCell className="font-medium">{style.name}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">{style.operations.length}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {style.totalSmv.toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/dashboard/styles/${style.id}`} passHref>
                    <Button variant="outline" size="sm">Manage</Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
