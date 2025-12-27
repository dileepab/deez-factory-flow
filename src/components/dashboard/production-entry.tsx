'use client';

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
import { useCollection } from "@/firebase/firestore/use-collection";
import { firestore } from "@/firebase/client";
import { collection, query, where } from "firebase/firestore";
import type { User, GarmentStyle } from "@/lib/types";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import { useMemo } from "react";

const timeSlots = [
  "07:30 - 08:30", // 60 mins
  "08:30 - 09:30", // 60 mins
  "09:30 - 10:15", // 45 mins
  "10:30 - 11:30", // 60 mins
  "11:30 - 12:30", // 60 mins
  "12:30 - 13:00", // 30 mins
  "13:30 - 14:30", // 60 mins
  "14:30 - 15:15", // 45 mins
  "15:30 - 16:30", // 60 mins
  "16:30 - 17:30", // 60 mins
  "17:30 - 18:30", // 60 mins
  "18:30 - 19:30", // 60 mins
  "19:30 - 20:30", // 60 mins
  "20:30 - 21:30", // 60 mins
];

// Updated schema to match our new, leaner API endpoint.
const productionSchema = z.object({
  operatorId: z.string().min(1, "Please select an operator."),
  styleId: z.string().min(1, "Please select a style."),
  operationId: z.string().min(1, "Please select an operation."),
  hourlyRange: z.string().min(1, "Please select a time slot."),
  quantity: z.coerce.number().min(1, "Quantity must be at least 1."),
  reworkQuantity: z.coerce.number().min(0, "Rework cannot be negative.").optional().default(0),
});

// Helper to calculate the duration of a time slot in minutes.
const getDurationInMinutes = (range: string): number => {
  if (!range) return 0;
  try {
    const [start, end] = range.split(' - ');
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    // Create dates on the same day to calculate the difference
    const startDate = new Date(0, 0, 0, startH, startM, 0);
    const endDate = new Date(0, 0, 0, endH, endM, 0);
    return (endDate.getTime() - startDate.getTime()) / (1000 * 60);
  } catch (e) {
    console.error("Could not calculate duration for range:", range);
    return 0;
  }
};

export function ProductionEntry() {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof productionSchema>>({
    resolver: zodResolver(productionSchema),
    defaultValues: {
      operatorId: "",
      styleId: "",
      operationId: "",
      hourlyRange: "",
      quantity: undefined,
      reworkQuantity: 0,
    },
  });
  
  const selectedStyleId = form.watch("styleId");

  const operatorsQuery = useMemoFirebase(
    () => firestore ? query(collection(firestore, 'users'), where('role', '==', 'operator')) : null, 
    []
  );
  const { data: operators, isLoading: operatorsLoading } = useCollection<User>(operatorsQuery);

  const stylesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'styles'), where('status', '==', 'active')) : null, []);
  const { data: styles, isLoading: stylesLoading } = useCollection<GarmentStyle>(stylesQuery);
  
  const operations = useMemo(() => {
    if (!selectedStyleId || !styles) return [];
    const selectedStyle = styles.find(style => style.id === selectedStyleId);
    return selectedStyle?.operations || [];
  }, [selectedStyleId, styles]);


  async function onSubmit(values: z.infer<typeof productionSchema>) {
    try {
      const operatorName = operators?.find(op => op.id === values.operatorId)?.name || 'Unknown Operator';

      // 1. Calculate worked minutes from the selected time slot.
      const workedMinutes = getDurationInMinutes(values.hourlyRange);
      if (workedMinutes <= 0) {
        throw new Error("Invalid time range selected.");
      }

      // 2. Prepare the payload for our new, correct API endpoint.
      const apiPayload = {
        operatorId: values.operatorId,
        styleId: values.styleId,
        operationId: values.operationId,
        quantity: values.quantity,
        reworkQuantity: values.reworkQuantity,
        workedMinutes: workedMinutes,
      };

      // 3. Call the new backend endpoint to log production.
      const response = await fetch('/api/log-production', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apiPayload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "An unknown error occurred.");
      }
      
      // 4. Show success toast and reset the form for the next entry.
      toast({
        title: "Production Logged",
        description: `Successfully logged ${values.quantity} units for ${operatorName}.`,
      });

      form.reset({
        ...values,
        operationId: "",
        quantity: undefined,
        reworkQuantity: 0,
      });

    } catch (error) {
       console.error("Error logging production: ", error);
       toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to log production data.",
      });
    }
  }

  return (
    <Card id="production" className="w-full mx-auto">
      <CardHeader>
        <CardTitle>Hourly Production Entry</CardTitle>
        <CardDescription>
          Log production data for an operator for a specific time slot.
        </CardDescription>
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
                  <Select onValueChange={field.onChange} value={field.value} disabled={operatorsLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={operatorsLoading ? "Loading..." : "Select an operator"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {operators?.map(op => <SelectItem key={op.id} value={op.id}>{op.name || op.id}</SelectItem>)}
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
                  <Select 
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue('operationId', '');
                    }} 
                    value={field.value} 
                    disabled={stylesLoading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={stylesLoading ? "Loading..." : "Select a style"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                       {styles?.map(style => <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="hourlyRange"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time Slot</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a time slot" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {timeSlots.map(slot => <SelectItem key={slot} value={slot}>{slot}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="operationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operation</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!selectedStyleId || operations.length === 0}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={!selectedStyleId ? "First select a style" : "Select an operation"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {operations.map(op => <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity Produced</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="e.g., 50" {...field} value={field.value ?? ""} />
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
                      <Input type="number" placeholder="e.g., 2" {...field} value={field.value ?? ""} />
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