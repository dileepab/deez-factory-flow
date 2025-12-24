'use client';

import { useState, useEffect, Fragment, useMemo } from 'react';
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
import { PlusCircle, Loader2, RefreshCw, ChevronDown, ChevronRight, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';
import type { GarmentStyle } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { GARMENT_STYLES } from '@/lib/data';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { StyleProgress } from './style-progress';

const ITEMS_PER_PAGE = 5;

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
  const [statusFilter, setStatusFilter] = useState('active');
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

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
        const correctedStyle = { ...style, totalSmv, quantity: 1000, status: 'active' as const };

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
      startDate: formData.get('startDate') as string,
      quantity: parseInt(formData.get('quantity') as string, 10),
      totalSmv: 0,
      operations: [],
      status: 'active' as const,
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

  const handleUpdateStyleStatus = async (styleId: string, status: 'active' | 'completed') => {
    if (!firestore) return;

    try {
      const styleRef = doc(firestore, 'styles', styleId);
      await setDoc(styleRef, { status }, { merge: true });
      toast({
        title: 'Style Status Updated',
        description: `Successfully set style to ${status}`,
      });
    } catch (error) {
      console.error('Error updating style status: ', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update style status. Please try again.',
      });
    }
  }

  const toggleRow = (id: string) => {
    setExpandedRows(prev =>
        prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
    );
  };

  const sortedStyles = useMemo(() => {
    if (!styles) return [];
    return [...styles].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }, [styles]);

  const filteredStyles = useMemo(() => {
    return sortedStyles.filter(style => {
        const searchTermMatch = style.name.toLowerCase().includes(searchTerm.toLowerCase());
        if (statusFilter === 'all') {
            return searchTermMatch;
        }
        return searchTermMatch && (style.status || 'active') === statusFilter;
    });
}, [sortedStyles, searchTerm, statusFilter]);

  const paginatedStyles = filteredStyles.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const totalPages = Math.ceil(filteredStyles.length / ITEMS_PER_PAGE);


  return (
    <Card id="styles">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <CardTitle>Garment Style Management</CardTitle>
          <CardDescription>View, add, or manage garment styles.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
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
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="startDate" className="text-right">
                    Start Date
                  </Label>
                  <Input
                    id="startDate"
                    name="startDate"
                    type="date"
                    className="col-span-3"
                    required
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="quantity" className="text-right">
                    Quantity
                  </Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    className="col-span-3"
                    required
                    defaultValue="1000"
                  />
                </div>
                <Button type="submit">Add Style</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="flex flex-wrap items-center gap-4 mb-4">
            <Input
                placeholder="Filter styles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
            />
            <div className="flex items-center gap-2">
                <Button variant={statusFilter === 'all' ? 'secondary' : 'outline'} size="sm" onClick={() => setStatusFilter('all')}>All</Button>
                <Button variant={statusFilter === 'active' ? 'secondary' : 'outline'} size="sm" onClick={() => setStatusFilter('active')}>Active</Button>
                <Button variant={statusFilter === 'completed' ? 'secondary' : 'outline'} size="sm" onClick={() => setStatusFilter('completed')}>Completed</Button>
            </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Style</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Ops</TableHead>
              <TableHead className="text-right">SMV</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(stylesLoading || isSeeding) && (
              <TableRow>
                <TableCell colSpan={7} className="text-center">
                  <div className="flex justify-center items-center">
                    <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                    {isSeeding ? 'Seeding initial data...' : 'Loading styles...'}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {paginatedStyles.map(style => (
                <Fragment key={style.id}>
                  <TableRow>
                    <TableCell className="font-medium">{style.name}</TableCell>
                    <TableCell>{style.startDate}</TableCell>
                    <TableCell>{style.quantity}</TableCell>
                    <TableCell>
                        <Badge variant={style.status === 'completed' ? 'outline' : 'default'}>
                            {style.status}
                        </Badge>
                    </TableCell>
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
                          <TableCell colSpan={7}>
                              <div className="p-4 grid gap-4">
                                  <div className="flex justify-between items-center">
                                    <h4 className="font-semibold">Progress for {style.name}</h4>
                                    <div className="flex items-center gap-2">
                                        <Link href={`/dashboard/styles/${style.id}`} passHref>
                                            <Button variant="outline" size="sm">
                                                <Pencil className="mr-2 h-4 w-4" />
                                                Manage Operations
                                            </Button>
                                        </Link>
                                        {style.status === 'active' ? (
                                            <Button variant="outline" size="sm" onClick={() => handleUpdateStyleStatus(style.id, 'completed') }>
                                                <CheckCircle className="mr-2 h-4 w-4" />
                                                Mark as Complete
                                            </Button>
                                        ) : (
                                            <Button variant="outline" size="sm" onClick={() => handleUpdateStyleStatus(style.id, 'active') }>
                                                <XCircle className="mr-2 h-4 w-4" />
                                                Re-open Style
                                            </Button>
                                        )}
                                    </div>
                                  </div>
                                  <StyleProgress style={style} />
                                  <h4 className="font-semibold mt-4">Operations for {style.name}</h4>
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
        <div className="flex items-center justify-end space-x-2 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          <span className="text-sm">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
