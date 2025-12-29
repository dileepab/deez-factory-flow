'use client';

import { useState, useMemo } from 'react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, where, doc, addDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import type { GarmentStyle, Operation } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Edit, Trash, Loader2, MoreVertical, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const SMV_CONVERSION_RATE = 20; // Example: 1 minute = 20 cents

export function StyleManagement() {
  const { toast } = useToast();
  const [isNewStyleDialogOpen, setIsNewStyleDialogOpen] = useState(false);
  const [isEditStyleDialogOpen, setIsEditStyleDialogOpen] = useState(false);
  const [isOperationDialogOpen, setIsOperationDialogOpen] = useState(false);
  const [styleToDelete, setStyleToDelete] = useState<GarmentStyle | null>(null);
  const [operationToDelete, setOperationToDelete] = useState<{ styleId: string; opId: string; } | null>(null);
  
  const [currentStyle, setCurrentStyle] = useState<GarmentStyle | null>(null);
  const [currentOperation, setCurrentOperation] = useState<Partial<Operation> | null>(null);
  
  const [newStyleName, setNewStyleName] = useState("");
  const [newStyleQuantity, setNewStyleQuantity] = useState<number>(0);
  const [newOperationName, setNewOperationName] = useState("");
  const [newOperationTime, setNewOperationTime] = useState<number>(0);

  const activeStylesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'styles'), where('status', '==', 'active')) : null, []);
  const { data: styles, isLoading, error } = useCollection<GarmentStyle>(activeStylesQuery);

  const totalSmv = useMemo(() => {
    if (!currentStyle || !currentStyle.operations) return 0;
    return currentStyle.operations.reduce((acc, op) => acc + (op.time || 0), 0);
  }, [currentStyle]);

  const handleOpenNewStyleDialog = () => {
    setIsNewStyleDialogOpen(true);
    setNewStyleName("");
    setNewStyleQuantity(0);
  };

  const handleSaveNewStyle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !newStyleName || newStyleQuantity <= 0) return;
    try {
      await addDoc(collection(firestore, 'styles'), {
        name: newStyleName,
        orderQuantity: newStyleQuantity,
        status: 'active',
        totalSmv: 0,
        operations: []
      });
      toast({ title: 'Style Created', description: `Style "${newStyleName}" has been added.` });
      setIsNewStyleDialogOpen(false);
    } catch (error) {
      console.error("Error creating style: ", error);
      toast({ variant: "destructive", title: "Error", description: "Could not create the new style." });
    }
  };

  const handleOpenEditStyleDialog = (style: GarmentStyle) => {
    setCurrentStyle(style);
    setNewStyleName(style.name);
    setNewStyleQuantity(style.quantity);
    setIsEditStyleDialogOpen(true);
  };

  const handleUpdateStyle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !currentStyle || !newStyleName || newStyleQuantity <= 0) return;
    try {
      const styleRef = doc(firestore, 'styles', currentStyle.id);
      await updateDoc(styleRef, { name: newStyleName, orderQuantity: newStyleQuantity });
      toast({ title: 'Style Updated', description: `Style "${newStyleName}" has been updated.` });
      setIsEditStyleDialogOpen(false);
      setCurrentStyle(null);
    } catch (error) {
      console.error("Error updating style: ", error);
      toast({ variant: "destructive", title: "Error", description: "Could not update the style." });
    }
  };

  const handleOpenOperationDialog = (style: GarmentStyle, operation: Partial<Operation> | null = null) => {
    setCurrentStyle(style);
    if (operation) {
      setCurrentOperation(operation);
      setNewOperationName(operation.name || "");
      setNewOperationTime(operation.time || 0);
    } else {
      setCurrentOperation(null);
      setNewOperationName("");
      setNewOperationTime(0);
    }
    setIsOperationDialogOpen(true);
  };

  const handleSaveOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !currentStyle || !newOperationName || newOperationTime <= 0) return;

    const styleRef = doc(firestore, 'styles', currentStyle.id);
    let newOperations = [...(currentStyle.operations || [])];
    let newTotalSmv = totalSmv;

    if (currentOperation && currentOperation.id) { // Editing existing operation
      const opIndex = newOperations.findIndex(op => op.id === currentOperation.id);
      if (opIndex > -1) {
        const oldTime = newOperations[opIndex].time || 0;
        newTotalSmv = newTotalSmv - oldTime + newOperationTime;
        newOperations[opIndex] = { ...newOperations[opIndex], name: newOperationName, time: newOperationTime };
      }
    } else { // Adding new operation
      newOperations.push({ id: `op_${Date.now()}`, name: newOperationName, time: newOperationTime, completedQuantity: 0 });
      newTotalSmv += newOperationTime;
    }

    try {
      await updateDoc(styleRef, { operations: newOperations, totalSmv: newTotalSmv });
      toast({ title: `Operation ${currentOperation ? 'Updated' : 'Added'}`, description: `Operation "${newOperationName}" has been saved.` });
      setIsOperationDialogOpen(false);
      setCurrentStyle(null);
      setCurrentOperation(null);
    } catch (error) {
      console.error("Error saving operation: ", error);
      toast({ variant: "destructive", title: "Error", description: "Could not save the operation." });
    }
  };
  
  const handleDeleteStyle = async () => {
    if (!firestore || !styleToDelete) return;
    try {
        const styleRef = doc(firestore, 'styles', styleToDelete.id);
        const productionQuery = query(collection(firestore, "production"), where("styleId", "==", styleToDelete.id));
        const productionSnapshot = await getDocs(productionQuery);

        const batch = writeBatch(firestore);
        productionSnapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        batch.delete(styleRef);
        await batch.commit();

        toast({ title: 'Style Deleted', description: `Style "${styleToDelete.name}" and all its production data have been removed.` });
    } catch (error) {
        console.error("Error deleting style: ", error);
        toast({ variant: "destructive", title: "Deletion Failed", description: "Could not delete the style and its associated data." });
    } finally {
        setStyleToDelete(null);
    }
  };

  const handleDeleteOperation = async () => {
      if (!firestore || !operationToDelete) return;
      const { styleId, opId } = operationToDelete;
      try {
          const styleRef = doc(firestore, 'styles', styleId);
          const styleDoc = await getDoc(styleRef);
          if (styleDoc.exists()) {
              const styleData = styleDoc.data() as GarmentStyle;
              const operationToRemove = styleData.operations.find(op => op.id === opId);
              const newOperations = styleData.operations.filter(op => op.id !== opId);
              const newTotalSmv = styleData.totalSmv - (operationToRemove?.time || 0);
              await updateDoc(styleRef, { operations: newOperations, totalSmv: newTotalSmv });
              toast({ title: 'Operation Deleted', description: 'The operation has been removed from the style.' });
          }
      } catch (error) {
          console.error("Error deleting operation: ", error);
          toast({ variant: "destructive", title: "Error", description: "Could not delete the operation." });
      } finally {
          setOperationToDelete(null);
      }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (error) {
    return <div className="text-red-500 text-center">Error loading styles: {error.message}</div>;
  }

  return (
    <>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Garment Style Management</CardTitle>
                    <CardDescription>Add, edit, and manage garment styles and their operations.</CardDescription>
                </div>
                <Button onClick={handleOpenNewStyleDialog}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add New Style
                </Button>
            </CardHeader>
            <CardContent>
                 {styles && styles.length > 0 ? (
                    <div className="space-y-4">
                        {styles.map(style => {
                            const totalCompleted = style.operations?.reduce((sum, op) => sum + (op.completedQuantity || 0), 0) || 0;
                            const averageProgress = style.orderQuantity > 0 && style.operations?.length > 0
                                ? (totalCompleted / (style.orderQuantity * style.operations.length)) * 100
                                : 0;

                            return (
                                <Card key={style.id} className="overflow-hidden">
                                    <CardHeader className="bg-muted/50 p-4 flex flex-row items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div>
                                                <CardTitle className="text-lg">{style.name}</CardTitle>
                                                <CardDescription>
                                                    Order Quantity: {style.orderQuantity} units | Total SMV: {(style.totalSmv / 60).toFixed(2)} min
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className="w-32 text-right">
                                              <Progress value={averageProgress} className="h-2" />
                                              <span className="text-xs text-muted-foreground">Overall: {averageProgress.toFixed(0)}%</span>
                                          </div>
                                          <DropdownMenu>
                                              <DropdownMenuTrigger asChild>
                                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                                      <span className="sr-only">Open menu</span>
                                                      <MoreVertical className="h-4 w-4" />
                                                  </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end">
                                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                  <DropdownMenuItem onClick={() => handleOpenEditStyleDialog(style)}>
                                                      <Edit className="mr-2 h-4 w-4" /> Edit Style
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem onClick={() => handleOpenOperationDialog(style)}>
                                                      <PlusCircle className="mr-2 h-4 w-4" /> Add Operation
                                                  </DropdownMenuItem>
                                                  <DropdownMenuSeparator />
                                                  <DropdownMenuItem onClick={() => setStyleToDelete(style)} className="text-red-600">
                                                      <Trash className="mr-2 h-4 w-4" /> Delete Style
                                                  </DropdownMenuItem>
                                              </DropdownMenuContent>
                                          </DropdownMenu>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-1/2">Operation Name</TableHead>
                                                    <TableHead>SMV (seconds)</TableHead>
                                                    <TableHead>Cost</TableHead>
                                                    <TableHead className="w-1/4 text-center">Progress</TableHead>
                                                    <TableHead className="text-right">Actions</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {style.operations && style.operations.length > 0 ? style.operations.map(op => {
                                                  const progress = style.orderQuantity > 0 ? ((op.completedQuantity || 0) / style.orderQuantity) * 100 : 0;
                                                  return (
                                                    <TableRow key={op.id}>
                                                        <TableCell className="font-medium">{op.name}</TableCell>
                                                        <TableCell>{op.time}</TableCell>
                                                        <TableCell>${((op.time / 60) * SMV_CONVERSION_RATE / 100).toFixed(2)}</TableCell>
                                                        <TableCell className="text-center">
                                                            <div className="flex items-center gap-2">
                                                                <Progress value={progress} className="h-2 flex-1" />
                                                                <span className="text-xs font-medium w-12 text-right">{Math.min(100, progress).toFixed(0)}%</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenOperationDialog(style, op)}>
                                                                <Edit className="h-4 w-4" />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => setOperationToDelete({ styleId: style.id, opId: op.id })}>
                                                                <Trash className="h-4 w-4" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                  )
                                                }) : (
                                                    <TableRow>
                                                        <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                                            No operations defined for this style. <Button variant="link" className="p-0 h-auto" onClick={() => handleOpenOperationDialog(style)}>Add one now</Button>.
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                ) : (
                     <div className="text-center text-muted-foreground py-12">
                        <p>No active garment styles found.</p>
                        <Button variant="link" onClick={handleOpenNewStyleDialog}>Create the first one</Button>
                    </div>
                )}
            </CardContent>
        </Card>

        {/* New/Edit Style Dialog */}
        <Dialog open={isNewStyleDialogOpen || isEditStyleDialogOpen} onOpenChange={(isOpen) => { if (!isOpen) { setIsNewStyleDialogOpen(false); setIsEditStyleDialogOpen(false); setCurrentStyle(null); } }}>
            <DialogContent>
                <form onSubmit={isEditStyleDialogOpen ? handleUpdateStyle : handleSaveNewStyle}>
                    <DialogHeader>
                        <DialogTitle>{isEditStyleDialogOpen ? "Edit Style" : "Create New Garment Style"}</DialogTitle>
                        <DialogDescription>{isEditStyleDialogOpen ? "Update the details for this style." : "Enter the details for the new style."}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="style-name" className="text-right">Style Name</Label>
                            <Input id="style-name" value={newStyleName} onChange={(e) => setNewStyleName(e.target.value)} className="col-span-3" required />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="order-quantity" className="text-right">Order Quantity</Label>
                            <Input id="order-quantity" type="number" value={newStyleQuantity} onChange={(e) => setNewStyleQuantity(Number(e.target.value))} className="col-span-3" required min="1" />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                        <Button type="submit">{isEditStyleDialogOpen ? "Save Changes" : "Create Style"}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>


        {/* Add/Edit Operation Dialog */}
        <Dialog open={isOperationDialogOpen} onOpenChange={(isOpen) => { if (!isOpen) setIsOperationDialogOpen(false); }}>
            <DialogContent>
                <form onSubmit={handleSaveOperation}>
                    <DialogHeader>
                        <DialogTitle>{currentOperation ? "Edit Operation" : "Add New Operation"}</DialogTitle>
                         <DialogDescription>Style: {currentStyle?.name}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="op-name" className="text-right">Op Name</Label>
                            <Input id="op-name" value={newOperationName} onChange={(e) => setNewOperationName(e.target.value)} className="col-span-3" required />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="op-time" className="text-right">Time (seconds)</Label>
                            <Input id="op-time" type="number" value={newOperationTime} onChange={(e) => setNewOperationTime(Number(e.target.value))} className="col-span-3" required min="1" />
                        </div>
                    </div>
                    <DialogFooter>
                         <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                        <Button type="submit">{currentOperation ? "Save Changes" : "Add Operation"}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
        
        {/* Delete Style Confirmation */}
        <AlertDialog open={!!styleToDelete} onOpenChange={() => setStyleToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete the style <span className="font-bold">{styleToDelete?.name}</span> and all associated production data.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteStyle}>Continue</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        {/* Delete Operation Confirmation */}
        <AlertDialog open={!!operationToDelete} onOpenChange={() => setOperationToDelete(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete Operation?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Are you sure you want to remove this operation? This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteOperation}>Delete</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </>
  );
}
