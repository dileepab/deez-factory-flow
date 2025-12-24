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
import { CalendarIcon, Save } from "lucide-react";
import { useCollection } from "@/firebase/firestore/use-collection";
import { firestore } from "@/firebase/client";
import { collection, addDoc, query, where, Timestamp } from "firebase/firestore";
import type { User, GarmentStyle } from "@/lib/types";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import { useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";

const timeSlots = [
  "07:30 - 08:30",
  "08:30 - 09:30",
  "09:30 - 10:15",
  "10:30 - 11:30",
  "11:30 - 12:30",
  "12:30 - 13:00",
  "13:30 - 14:30",
  "14:30 - 15:15",
  "15:30 - 16:30",
  "16:30 - 17:30",
  "17:30 - 18:30",
  "18:30 - 19:30",
  "19:30 - 20:30",
  "20:30 - 21:30",
];

const productionSchema = z.object({
  date: z.date(),
  operatorId: z.string().min(1, "Please select an operator."),
  styleId: z.string().min(1, "Please select a style."),
  operationId: z.string().min(1, "Please select an operation."),
  hourlyRange: z.string().min(1, "Please select an hourly range."),
  cumulativeQuantity: z.coerce.number().min(1, "Quantity must be at least 1."),
  reworkQuantity: z.coerce.number().min(0, "Rework quantity cannot be negative.").optional().default(0),
});

const getDurationInMinutes = (range: string): number => {
  if (!range) return 0;
  try {
    const [start, end] = range.split(' - ');
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const startDate = new Date(2000, 0, 1, startH, startM, 0);
    const endDate = new Date(2000, 0, 1, endH, endM, 0);
    return (endDate.getTime() - startDate.getTime()) / (1000 * 60);
  } catch (e) {
    return 0;
  }
};

export function ProductionEntry() {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof productionSchema>>({
    resolver: zodResolver(productionSchema),
    defaultValues: {
      date: new Date(),
      operatorId: "",
      styleId: "",
      operationId: "",
      hourlyRange: "",
      cumulativeQuantity: undefined,
      reworkQuantity: 0,
    },
  });
  
  const selectedStyleId = form.watch("styleId");
  const selectedHourlyRange = form.watch("hourlyRange");

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
    if (!firestore) return;
    try {
      const productionEntriesRef = collection(firestore, 'production');
      
      const operatorName = operators?.find(op => op.id === values.operatorId)?.name || 'Unknown Operator';
      const operationName = operations?.find(op => op.id === values.operationId)?.name || 'Unknown Operation';

      const { date, hourlyRange } = values;
      const [startTime] = hourlyRange.split(' - ');
      const [hours, minutes] = startTime.split(':').map(Number);

      const finalTimestamp = new Date(date);
      finalTimestamp.setHours(hours, minutes, 0, 0);

      await addDoc(productionEntriesRef, {
        ...values,
        operatorName,
        operationName,
        timestamp: Timestamp.fromDate(finalTimestamp),
      });

      toast({
        title: "Production Logged",
        description: `Successfully logged ${values.cumulativeQuantity} units for ${operatorName} on ${format(date, 'PPP')}.`,
      });

      // Trigger the backend to update stats
      await fetch('/api/update-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operatorId: values.operatorId,
          date: values.date.toISOString(), // Send date in ISO format
        }),
      });
      
      form.reset({
        ...values,
        operationId: "",
        cumulativeQuantity: undefined,
        reworkQuantity: 0,
      });

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
    <Card id="production" className="w-full mx-auto">
      <CardHeader>
        <CardTitle>Hourly Production Entry</CardTitle>
        <CardDescription>
          Select the date, operator, style, and time before choosing an operation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Production Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-[240px] pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date > new Date() || date < new Date("2023-01-01")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            <FormField
              control={form.control}
              name="operatorId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Operator</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={operatorsLoading || !operators || operators.length === 0}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={operatorsLoading ? "Loading operators..." : (operators && operators.length > 0 ? "Select an operator" : "No operators found")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {operators?.map(op => (
                        <SelectItem key={op.id} value={op.id}>{op.name || op.id}</SelectItem>
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
                  <Select 
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue('operationId', '');
                    }} 
                    value={field.value} 
                    disabled={stylesLoading || !styles || styles.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={stylesLoading ? "Loading styles..." : (styles && styles.length > 0 ? "Select a style" : "No active styles found")} />
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
            <FormField
              control={form.control}
              name="hourlyRange"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hourly Range</FormLabel>
                  <Select 
                     onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue('operationId', '');
                    }} 
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a time slot" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {timeSlots.map(slot => (
                        <SelectItem key={slot} value={slot}>{slot}</SelectItem>
                      ))}
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
                  <Select onValueChange={field.onChange} value={field.value} disabled={!selectedStyleId || !selectedHourlyRange || operations.length === 0}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={!selectedStyleId ? "First select a style" : (!selectedHourlyRange ? "Next, select an hourly range" : "Select an operation")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {operations.map(op => {
                        const duration = getDurationInMinutes(selectedHourlyRange);
                        const smv = parseFloat(op.time as any);
                        const targetQuantity = duration > 0 && smv > 0 ? Math.floor((duration * 60) / smv) : 0;
                        return (
                          <SelectItem key={op.id} value={op.id}>
                            {op.name} - {targetQuantity}
                          </SelectItem>
                        );
                      })}
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
                      <Input type="number" placeholder="e.g., 150" {...field} value={field.value ?? ""} />
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
                      <Input type="number" placeholder="e.g., 5" {...field} value={field.value ?? ""} />
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
