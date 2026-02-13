'use client';

import { useState, useMemo } from 'react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useConfiguration } from '@/firebase/firestore/use-configuration';
import { firestore } from '@/firebase/client';
import { collection, query, where, doc, addDoc, updateDoc, deleteDoc, writeBatch, getDoc, getDocs } from 'firebase/firestore';
import type { GarmentStyle, GarmentOperation, MachineType } from '@/lib/types';
import { MACHINE_TYPES } from '@/lib/constants';
import { useMachineTypes } from '@/hooks/use-machine-types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Edit, Trash, Loader2, MoreVertical, Settings2, CheckCircle, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StyleProgress } from '@/components/dashboard/style-progress';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

export function StyleManagement() {
    const { toast } = useToast();
    const { allTypes } = useMachineTypes();
    const { data: config, isLoading: isConfigLoading } = useConfiguration();
    const [statusFilter, setStatusFilter] = useState<'active' | 'completed'>('active');

    const [isNewStyleDialogOpen, setIsNewStyleDialogOpen] = useState(false);
    const [isEditStyleDialogOpen, setIsEditStyleDialogOpen] = useState(false);
    const [isOperationDialogOpen, setIsOperationDialogOpen] = useState(false);
    const [styleToDelete, setStyleToDelete] = useState<GarmentStyle | null>(null);
    const [operationToDelete, setOperationToDelete] = useState<{ styleId: string; opId: string; } | null>(null);

    const [currentStyle, setCurrentStyle] = useState<GarmentStyle | null>(null);
    const [currentOperation, setCurrentOperation] = useState<Partial<GarmentOperation> | null>(null);

    const [newStyleName, setNewStyleName] = useState("");
    const [newStyleQuantity, setNewStyleQuantity] = useState<number>(0);
    const [newOperationName, setNewOperationName] = useState("");
    const [newOperationTime, setNewOperationTime] = useState<number>(0);
    const [newMachineType, setNewMachineType] = useState<string>(MACHINE_TYPES[0]);
    const [newOpDependencies, setNewOpDependencies] = useState<string[]>([]);

    const stylesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'styles'), where('status', '==', statusFilter)) : null, [statusFilter]);
    const { data: styles, isLoading: areStylesLoading, error: stylesError } = useCollection<GarmentStyle>(stylesQuery);

    const isLoading = areStylesLoading || isConfigLoading;

    const handleSaveNewStyle = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !newStyleName || newStyleQuantity <= 0) return;
        try {
            await addDoc(collection(firestore, 'styles'), {
                name: newStyleName,
                quantity: newStyleQuantity,
                status: 'active',
                totalSmv: 0,
                operations: [],
                startDate: new Date().toISOString(),
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
            await updateDoc(styleRef, { name: newStyleName, quantity: newStyleQuantity });
            toast({ title: 'Style Updated', description: `Style "${newStyleName}" has been updated.` });
            setIsEditStyleDialogOpen(false);
            setCurrentStyle(null);
        } catch (error) {
            console.error("Error updating style: ", error);
            toast({ variant: "destructive", title: "Error", description: "Could not update the style." });
        }
    };

    const handleOpenOperationDialog = (style: GarmentStyle, operation: Partial<GarmentOperation> | null = null) => {
        setCurrentStyle(style);
        if (operation) {
            setCurrentOperation(operation);
            setNewOperationName(operation.name || "");
            setNewOperationTime(operation.smv || 0);
            setNewMachineType(operation.machineType || MACHINE_TYPES[0]);
            setNewOpDependencies(operation.dependencies || []);
        } else {
            setCurrentOperation(null);
            setNewOperationName("");
            setNewOperationTime(0);
            setNewMachineType(MACHINE_TYPES[0]);
            setNewOpDependencies([]);
        }
        setIsOperationDialogOpen(true);
    };

    const handleSaveOperation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !currentStyle || !newOperationName || newOperationTime <= 0) return;

        const styleRef = doc(firestore, 'styles', currentStyle.id);
        const docSnap = await getDoc(styleRef);
        if (!docSnap.exists()) {
            toast({ variant: "destructive", title: "Error", description: "Style not found." });
            return;
        }

        const existingStyle = docSnap.data() as GarmentStyle;
        let newOperations = [...(existingStyle.operations || [])];
        let newTotalSmvInMinutes = existingStyle.totalSmv;
        const operationTimeInMinutes = newOperationTime / 60;

        if (currentOperation && currentOperation.id) { // Editing existing operation
            const opIndex = newOperations.findIndex(op => op.id === currentOperation.id);
            if (opIndex > -1) {
                const oldTimeInMinutes = (newOperations[opIndex].smv || 0) / 60;
                newTotalSmvInMinutes = newTotalSmvInMinutes - oldTimeInMinutes + operationTimeInMinutes;
                newOperations[opIndex] = { ...newOperations[opIndex], name: newOperationName, smv: newOperationTime, machineType: newMachineType, dependencies: newOpDependencies };
            }
        } else { // Adding new operation
            newOperations.push({
                id: `op_${Date.now()}`,
                name: newOperationName,
                smv: newOperationTime,
                completedQuantity: 0,
                machineType: newMachineType,
                dependencies: newOpDependencies,
            });
            newTotalSmvInMinutes += operationTimeInMinutes;
        }

        try {
            await updateDoc(styleRef, { operations: newOperations, totalSmv: newTotalSmvInMinutes });
            toast({ title: `Operation ${currentOperation ? 'Updated' : 'Saved'}` });
            setIsOperationDialogOpen(false);
            setCurrentStyle(null);
            setCurrentOperation(null);
        } catch (error) {
            console.error("Error saving operation: ", error);
            toast({ variant: "destructive", title: "Error", description: "Could not save the operation." });
        }
    };

    const handleToggleStatus = async (style: GarmentStyle) => {
        if (!firestore) return;
        try {
            const newStatus = style.status === 'active' ? 'completed' : 'active';
            const styleRef = doc(firestore, 'styles', style.id);
            await updateDoc(styleRef, { status: newStatus });
            toast({ title: 'Status Updated', description: `Style marked as ${newStatus}.` });
        } catch (error) {
            console.error("Error updating status:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not update status." });
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
                const newTotalSmv = styleData.totalSmv - ((operationToRemove?.smv || 0) / 60);
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
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Garment Style Management</CardTitle>
                    <CardDescription>Loading style data...</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-48">
                    <Loader2 className="h-8 w-8 animate-spin" />
                </CardContent>
            </Card>
        );
    }

    if (!config) {
        return (
            <Card className="border-destructive">
                <CardHeader>
                    <CardTitle className="text-destructive flex items-center"><Settings2 className="mr-2" /> Configuration Error</CardTitle>
                    <CardDescription className="text-destructive">
                        Could not load the application&apos;s main configuration. The Style Management features cannot be used.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p>Please ensure the main configuration is correctly set up in the database by an administrator.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Garment Style Management</CardTitle>
                        <CardDescription>Add, edit, and manage garment styles and their operations.</CardDescription>
                    </div>
                    <Button onClick={() => setIsNewStyleDialogOpen(true)}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Add New Style
                    </Button>
                </CardHeader>
                <CardContent>
                    <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="active">Active</TabsTrigger>
                            <TabsTrigger value="completed">Completed</TabsTrigger>
                        </TabsList>
                        <TabsContent value={statusFilter} className="pt-4">
                            {areStylesLoading && <div className="flex items-center justify-center h-48"><Loader2 className="h-8 w-8 animate-spin" /></div>}
                            {stylesError && <div className="text-red-500 text-center">Error loading styles: {stylesError.message}</div>}
                            {!areStylesLoading && !stylesError && styles && styles.length > 0 ? (
                                <Accordion type="multiple" className="space-y-4">
                                    {styles.map(style => {
                                        const hasProgress = style.operations?.some(op => (op.completedQuantity || 0) > 0);
                                        return (
                                            <AccordionItem key={style.id} value={style.id} asChild>
                                                <Card className="overflow-hidden">
                                                    <div className="flex items-center bg-muted/50 p-4 rounded-t-lg data-[state=closed]:rounded-lg">
                                                        <AccordionTrigger className="flex-1 hover:no-underline py-0 pr-4 [&>svg]:hidden text-left">
                                                            <div className="flex flex-col text-left">
                                                                <CardTitle className="text-lg">{style.name}</CardTitle>
                                                                <CardDescription className="mt-1 flex flex-col">
                                                                    <span>Quantity: {style.quantity} units</span>
                                                                    <span>Total SMV: {style.totalSmv.toFixed(2)} min</span>
                                                                </CardDescription>
                                                            </div>
                                                        </AccordionTrigger>
                                                        <div className="flex items-center gap-2 mr-4">
                                                            <div className="w-32 text-right">
                                                                <StyleProgress style={style} />
                                                            </div>
                                                            <DropdownMenu modal={false}>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                                        <span className="sr-only">Open menu</span>
                                                                        <MoreVertical className="h-4 w-4" />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end">
                                                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); setTimeout(() => handleToggleStatus(style), 0); }}>
                                                                        {style.status === 'active' ? (
                                                                            <>
                                                                                <CheckCircle className="mr-2 h-4 w-4" /> Mark as Completed
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <RotateCcw className="mr-2 h-4 w-4" /> Mark as Active
                                                                            </>
                                                                        )}
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); setTimeout(() => handleOpenEditStyleDialog(style), 0); }}>
                                                                        <Edit className="mr-2 h-4 w-4" /> Edit Style
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); setTimeout(() => handleOpenOperationDialog(style), 0); }}>
                                                                        <PlusCircle className="mr-2 h-4 w-4" /> Add Operation
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem
                                                                        disabled={hasProgress}
                                                                        onClick={(e) => { e.preventDefault(); setTimeout(() => setStyleToDelete(style), 0); }}
                                                                        className={hasProgress ? "text-muted-foreground" : "text-red-600"}
                                                                    >
                                                                        <Trash className="mr-2 h-4 w-4" /> Delete Style
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </div>
                                                        <AccordionTrigger className="flex-none w-8 py-0 hover:no-underline"></AccordionTrigger>
                                                    </div>
                                                    <AccordionContent className="p-0 border-t">
                                                        <Table>
                                                            <TableHeader>
                                                                <TableRow>
                                                                    <TableHead className="w-2/5">Operation</TableHead>
                                                                    <TableHead>Machine</TableHead>
                                                                    <TableHead>SMV (s)</TableHead>
                                                                    <TableHead>Cost</TableHead>
                                                                    <TableHead className="w-1/4 text-center">Progress</TableHead>
                                                                    <TableHead className="text-right">Actions</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {style.operations && style.operations.length > 0 ? style.operations.map(op => {
                                                                    const progress = style.quantity > 0 ? ((op.completedQuantity || 0) / style.quantity) * 100 : 0;
                                                                    return (
                                                                        <TableRow key={op.id}>
                                                                            <TableCell className="font-medium">{op.name}</TableCell>
                                                                            <TableCell className="text-muted-foreground">{op.machineType}</TableCell>
                                                                            <TableCell>{op.smv}</TableCell>
                                                                            <TableCell>Rs. {((op.smv / 60) * config.minuteValueLKR).toFixed(2)}</TableCell>
                                                                            <TableCell className="text-center">
                                                                                <div className="flex items-center flex-col gap-1">
                                                                                    <Progress value={progress} className="h-2 w-full" />
                                                                                    <span className="text-xs font-medium w-full text-right">{op.completedQuantity || 0} / {style.quantity}</span>
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
                                                                        <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                                                                            No operations defined. <Button variant="link" className="p-0 h-auto" onClick={() => handleOpenOperationDialog(style)}>Add one now</Button>.
                                                                        </TableCell>
                                                                    </TableRow>
                                                                )}
                                                            </TableBody>
                                                        </Table>
                                                    </AccordionContent>
                                                </Card>
                                            </AccordionItem>
                                        );
                                    })}
                                </Accordion>
                            ) : (
                                !areStylesLoading && <div className="text-center text-muted-foreground py-12">
                                    <p>No {statusFilter} styles found.</p>
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            {/* Dialogs */}
            <Dialog open={isNewStyleDialogOpen} onOpenChange={setIsNewStyleDialogOpen}>
                <DialogContent>
                    <form onSubmit={handleSaveNewStyle}>
                        <DialogHeader>
                            <DialogTitle>Create New Garment Style</DialogTitle>
                            <DialogDescription>Enter the details for the new style.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="style-name" className="text-right">Name</Label>
                                <Input id="style-name" value={newStyleName} onChange={(e) => setNewStyleName(e.target.value)} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="quantity" className="text-right">Quantity</Label>
                                <Input id="quantity" type="number" value={newStyleQuantity} onChange={(e) => setNewStyleQuantity(Number(e.target.value))} className="col-span-3" required min="1" />
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                            <Button type="submit">Create Style</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={isEditStyleDialogOpen} onOpenChange={(isOpen) => { if (!isOpen) { setIsEditStyleDialogOpen(false); setCurrentStyle(null); } }}>
                <DialogContent>
                    <form onSubmit={handleUpdateStyle}>
                        <DialogHeader>
                            <DialogTitle>Edit Style</DialogTitle>
                            <DialogDescription>Update the details of the selected style.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="edit-style-name" className="text-right">Name</Label>
                                <Input id="edit-style-name" value={newStyleName} onChange={(e) => setNewStyleName(e.target.value)} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="edit-quantity" className="text-right">Quantity</Label>
                                <Input id="edit-quantity" type="number" value={newStyleQuantity} onChange={(e) => setNewStyleQuantity(Number(e.target.value))} className="col-span-3" required min="1" />
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                            <Button type="submit">Save Changes</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={isOperationDialogOpen} onOpenChange={(isOpen) => { if (!isOpen) setIsOperationDialogOpen(false); }}>
                <DialogContent>
                    <form onSubmit={handleSaveOperation}>
                        <DialogHeader>
                            <DialogTitle>{currentOperation ? "Edit Operation" : "Add New Operation"}</DialogTitle>
                            <DialogDescription>For Style: {currentStyle?.name}</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="op-name" className="text-right">Name</Label>
                                <Input id="op-name" value={newOperationName} onChange={(e) => setNewOperationName(e.target.value)} className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="op-time" className="text-right">Time (s)</Label>
                                <Input id="op-time" type="number" value={newOperationTime} onChange={(e) => setNewOperationTime(Number(e.target.value))} className="col-span-3" required min="1" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="op-machine" className="text-right">Machine</Label>
                                <Select value={newMachineType} onValueChange={(value) => setNewMachineType(value)}>
                                    <SelectTrigger className="col-span-3">
                                        <SelectValue placeholder="Select a machine" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allTypes.map(type => (
                                            <SelectItem key={type} value={type}>{type}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <Label className="text-right pt-2">Dependencies</Label>
                                <div className="col-span-3 border rounded-md p-2">
                                    <ScrollArea className="h-[150px]">
                                        {currentStyle?.operations?.length ? (
                                            <div className="space-y-2">
                                                {currentStyle.operations
                                                    .filter(op => op.id !== currentOperation?.id)
                                                    .map(op => (
                                                        <div key={op.id} className="flex items-center space-x-2">
                                                            <Checkbox
                                                                id={`dep-${op.id}`}
                                                                checked={newOpDependencies.includes(op.id)}
                                                                onCheckedChange={(checked) => {
                                                                    if (checked) {
                                                                        setNewOpDependencies([...newOpDependencies, op.id]);
                                                                    } else {
                                                                        setNewOpDependencies(newOpDependencies.filter(id => id !== op.id));
                                                                    }
                                                                }}
                                                            />
                                                            <Label htmlFor={`dep-${op.id}`} className="text-sm font-normal cursor-pointer">
                                                                {op.name}
                                                            </Label>
                                                        </div>
                                                    ))
                                                }
                                                {currentStyle.operations.filter(op => op.id !== currentOperation?.id).length === 0 && (
                                                    <p className="text-sm text-muted-foreground">No other operations available.</p>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">No operations created yet.</p>
                                        )}
                                    </ScrollArea>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
                            <Button type="submit">{currentOperation ? "Save Changes" : "Add Operation"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!styleToDelete} onOpenChange={() => setStyleToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action will permanently delete the style <span className="font-bold">{styleToDelete?.name}</span> and all associated production data. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteStyle}>Continue</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

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
