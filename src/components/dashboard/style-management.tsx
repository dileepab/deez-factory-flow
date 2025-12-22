"use client"

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PlusCircle } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, addDoc } from "firebase/firestore";
import type { GarmentStyle } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";


export function StyleManagement() {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const stylesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'styles') : null, [firestore]);
  const { data: styles, isLoading: stylesLoading } = useCollection<GarmentStyle>(stylesQuery);
  const [open, setOpen] = useState(false);
  
  const handleAddStyle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firestore) return;
    
    const formData = new FormData(e.currentTarget);
    const newStyle = {
      name: formData.get("styleName") as string,
      totalSmv: parseFloat(formData.get("totalSmv") as string),
      operations: [], // Operations can be managed in a detail view
    };

    try {
      const docRef = await addDoc(collection(firestore, "styles"), newStyle);
      toast({
        title: "Style Added",
        description: `Successfully added style "${newStyle.name}".`,
      });
      setOpen(false);
    } catch (error) {
      console.error("Error adding style: ", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add style. Please try again.",
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
                    <Label htmlFor="styleName" className="text-right">Style Name</Label>
                    <Input id="styleName" name="styleName" className="col-span-3" required />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="totalSmv" className="text-right">Total SMV</Label>
                    <Input id="totalSmv" name="totalSmv" type="number" step="0.01" className="col-span-3" required/>
                </div>
                 <Button type="submit">Add Style</Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Style Name</TableHead>
              <TableHead className="text-center">Operations</TableHead>
              <TableHead className="text-right">Total SMV</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stylesLoading && (
              <TableRow>
                <TableCell colSpan={3} className="text-center">Loading styles...</TableCell>
              </TableRow>
            )}
            {styles?.map((style) => (
              <TableRow key={style.id}>
                <TableCell className="font-medium">{style.name}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">{style.operations.length}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{style.totalSmv.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
