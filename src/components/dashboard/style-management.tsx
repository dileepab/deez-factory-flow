"use client"

import { useState } from "react";
import { GARMENT_STYLES } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PlusCircle } from "lucide-react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function StyleManagement() {
  const [styles, setStyles] = useState(GARMENT_STYLES);
  const [open, setOpen] = useState(false);
  
  // This would be a proper form with react-hook-form in a real app
  const handleAddStyle = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newStyle = {
      id: `style-${Date.now()}`,
      name: formData.get("styleName") as string,
      totalSmv: parseFloat(formData.get("totalSmv") as string),
      operations: [],
    };
    setStyles([newStyle, ...styles]);
    setOpen(false);
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
            {styles.map((style) => (
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
