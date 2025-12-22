"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save } from "lucide-react";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import type { Operator, GarmentStyle } from "@/lib/types";

const productionSchema = z.object({
  operatorId: z.string().min(1, "Please select an operator."),
  styleId: z.string().min(1, "Please select a style."),
  cumulativeQuantity: z.coerce.number().min(1, "Quantity must be at least 1."),
  reworkQuantity: z.coerce.number().min(0, "Rework quantity cannot be negative.").optional().default(0),
});

export function ProductionEntry() {
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const operatorsQuery = useMemoFirebase(() => firestore ? collection(firestore, 'operators') : null, [firestore]);
  const { data: operators, isLoading: operatorsLoading } = useCollection<Operator>(operatorsQuery);

  const stylesQuery = useMemoFirebase(() => firestore ? collection(firestore, 'styles') : null, [firestore]);
  const { data: styles, isLoading: stylesLoading } = useCollection<GarmentStyle>(stylesQuery);

  const form = useForm<z.infer<typeof productionSchema>>({
    resolver: zodResolver(productionSchema),
    defaultValues: {
      reworkQuantity: 0,
    },
  });

  async function onSubmit(values: z.infer<typeof productionSchema>) {
    if (!firestore) return;
    try {
      const productionEntriesRef = collection(firestore, 'operators', values.operatorId, 'productionEntries');
      await addDoc(productionEntriesRef, {
        ...values,
        timestamp: serverTimestamp(),
      });

      toast({
        title: "Production Logged",
        description: `Successfully logged ${values.cumulativeQuantity} units for operator.`,
      });
      form.reset();
    } catch (error) {
       console.error("Error logging production: ", error);
       toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to log production data. Please try again.",
      });
    }
  }

  return (
    <Card id="production" className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Hourly Production Entry</CardTitle>
        <CardDescription>Enter production data for an operator. Optimized for mobile.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="operatorId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operator</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={operatorsLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={operatorsLoading ? "Loading operators..." : "Select an operator"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {operators?.map(op => (
                        <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="styleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Garment Style</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={stylesLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={stylesLoading ? "Loading styles..." : "Select a style"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                       {styles?.map(style => (
                        <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cumulativeQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cumulative Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="e.g., 150" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="reworkQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rework Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="e.g., 5" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button type="submit" className="w-full sm:w-auto" disabled={form.formState.isSubmitting}>
              <Save className="mr-2 h-4 w-4" /> Save Production
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
