'use client';

import { useState, useEffect, Fragment } from 'react';
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
import { PlusCircle, Loader2, RefreshCw, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
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
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRows, setExpandedRows] = useState<string[]>([]);

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
        const totalSmvInSeconds = style.operations.reduce((sum, op) => sum + op.time, 0);
        const totalSmv = totalSmvInSeconds / 60; // Convert to minutes
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

  const toggleRow = (id: string) => {
    setExpandedRows(prev =>
        prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };

  const filteredStyles = styles?.filter(style =>
    style.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
            <Button variant="destructive" disabled={isSeeding}>
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

          <Dialog open={open} onChange={setOpen}>
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
        <div className="flex items-center gap-2 mb-4">
            <Input
            placeholder="Filter styles..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
            />
        </div>
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
            {filteredStyles?.map(style => (
              <Fragment key={style.id}>
                <TableRow>
                  <TableCell className="font-medium">{style.name}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{style.operations.length}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {style.totalSmv.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => toggleRow(style.id)}>
                        {expandedRows.includes(style.id) ? (
                            <>
                                <ChevronDown className="mr-2 h-4 w-4" />
                                Hide
                            </>
                        ) : (
                            <>
                                <ChevronRight className="mr-2 h-4 w-4" />
                                View
                            </>
                        )}
                    </Button>
                  </TableCell>
                </TableRow>
                {expandedRows.includes(style.id) && (
                    <TableRow className="bg-muted/50">
                        <TableCell colSpan={4}>
                            <div className="p-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="font-semibold">Operations for {style.name}</h4>
                                    <Link href={`/dashboard/styles/${style.id}`} passHref>
                                        <Button variant="outline" size="sm">
                                            <Pencil className="mr-2 h-4 w-4" />
                                            Manage Operations
                                        </Button>
                                    </Link>
                                </div>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Operation Name</TableHead>
                                            <TableHead>Machine Type</TableHead>
                                            <TableHead className="text-right">Time (s)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {style.operations.map(op => (
                                            <TableRow key={op.id}>
                                                <TableCell>{op.name}</TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary">{op.machineType}</Badge>
                                                </TableCell>
                                                <TableCell className="text-right font-mono">{op.time}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </TableCell>
                    </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
