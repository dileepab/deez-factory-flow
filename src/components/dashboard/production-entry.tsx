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
import { Save, Calendar as CalendarIcon } from "lucide-react";
import { useCollection } from "@/firebase/firestore/use-collection";
import { firestore } from "@/firebase/client";
import { collection, query, where } from "firebase/firestore";
import type { User, GarmentStyle, DailyPlan } from "@/lib/types";
import { useMemoFirebase } from "@/firebase/use-memo-firebase";
import { useMemo, useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from 'date-fns';
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth-provider";
import { doc } from "firebase/firestore";
import { useDoc } from "@/firebase/firestore/use-doc";

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

// Helper: Convert HH:MM string to Work Minutes (Minutes from 7:30)
const getWorkMinutesFromTime = (timeStr: string): number => {
  if (!timeStr) return -1;
  const [h, m] = timeStr.split(':').map(Number);
  // 7:30 AM = 0
  // Time in minutes from midnight
  const totalM = h * 60 + m;
  const startM = 7 * 60 + 30; // 450
  return totalM - startM;
};

export function ProductionEntry() {
  const { user } = useAuth(); // Get current user
  const { toast } = useToast();
  const [entryDate, setEntryDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // Fetch Daily Plan for the selected date
  const dateStr = format(entryDate, 'yyyy-MM-dd');
  const planRef = useMemoFirebase(() => doc(firestore, 'daily_plans', dateStr), [dateStr]);
  const { data: dailyPlan } = useDoc<DailyPlan>(planRef);

  // Fetch User Profile to get Role
  const userProfileRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [user]);
  const { data: userProfile } = useDoc<User>(userProfileRef);

  const operatorsQuery = useMemoFirebase(
    () => firestore ? query(collection(firestore, 'users'), where('role', '==', 'operator')) : null,
    []
  );
  const { data: operators, isLoading: operatorsLoading } = useCollection<User>(operatorsQuery);

  const stylesQuery = useMemoFirebase(() => firestore ? query(collection(firestore, 'styles'), where('status', '==', 'active')) : null, []);
  const { data: styles, isLoading: stylesLoading } = useCollection<GarmentStyle>(stylesQuery);

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

  const selectedOperatorId = form.watch("operatorId");
  const selectedStyleId = form.watch("styleId");
  const selectedHourlyRange = form.watch("hourlyRange");

  // Lock Operator Field if User is Operator
  useEffect(() => {
    if (userProfile && userProfile.role === 'operator') {
      form.setValue("operatorId", userProfile.id);
    }
  }, [userProfile, form]);

  // Smart Auto-Fill Logic
  useEffect(() => {
    if (!dailyPlan || !selectedOperatorId || !selectedHourlyRange) return;

    const schedule = dailyPlan.schedules[selectedOperatorId];
    if (!schedule) return;

    // Parse selected range start
    const [startStr] = selectedHourlyRange.split(' - ');
    const checkTime = getWorkMinutesFromTime(startStr);

    // Find segment covering this start time
    const segment = schedule.find(s => s.start <= checkTime && s.end > checkTime);

    if (segment) {
      if (!styles) return;

      let targetStyleId = dailyPlan.styleId;
      const primaryStyle = styles.find(s => s.id === dailyPlan.styleId);
      const isPrimary = primaryStyle?.operations.some(o => o.id === segment.opId);

      if (!isPrimary && dailyPlan.nextStyleId) {
        targetStyleId = dailyPlan.nextStyleId;
      }

      if (targetStyleId) {
        form.setValue("styleId", targetStyleId);
        // Set Operation ID
        // Note: Ideally we wait for style change to propagate, but with react-hook-form 
        // setting both synchronously works if values are valid. 
        // The Select options depend on selectedStyleId which changes on next render.
        // However, form.setValue updates internal state immediately.
        // We might need to ensure the select component re-renders with new options.
        // We perform this in one go.
        form.setValue("operationId", segment.opId);

        const slotDuration = getDurationInMinutes(selectedHourlyRange);
        const targetStyle = styles.find(s => s.id === targetStyleId);
        const op = targetStyle?.operations.find(o => o.id === segment.opId);

        if (op && op.smv > 0) {
          const predictedQty = Math.floor(slotDuration / op.smv);
          form.setValue("quantity", predictedQty);
        }
      }
    }

  }, [selectedHourlyRange, selectedOperatorId, dailyPlan, styles, form]);

  const operations = useMemo(() => {
    if (!selectedStyleId || !styles) return [];
    const selectedStyle = styles.find(style => style.id === selectedStyleId);
    return selectedStyle?.operations || [];
  }, [selectedStyleId, styles]);


  async function onSubmit(values: z.infer<typeof productionSchema>) {
    try {
      const operatorName = operators?.find(op => op.id === values.operatorId)?.name || 'Unknown Operator';

      const workedMinutes = getDurationInMinutes(values.hourlyRange);
      if (workedMinutes <= 0) {
        throw new Error("Invalid time range selected.");
      }

      const apiPayload = {
        ...values,
        workedMinutes,
        // Pass the selected date to the API. It must be in a serializable format.
        date: entryDate.toISOString(),
      };

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

      toast({
        title: "Production Logged",
        description: `Successfully logged ${values.quantity} units for ${operatorName} on ${format(entryDate, "PPP")}.`,
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
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Hourly Production Entry</CardTitle>
          <CardDescription>
            Log production data for an operator for a specific time slot.
          </CardDescription>
        </div>
        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={"outline"}
              className={cn(
                "w-[240px] justify-start text-left font-normal",
                !entryDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {entryDate ? format(entryDate, "PPP") : <span>Pick a date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={entryDate}
              onSelect={(date) => {
                setEntryDate(date || new Date());
                setIsCalendarOpen(false);
              }}
              initialFocus
              disabled={(date) => date > new Date() || date < new Date("2020-01-01")}
            />
          </PopoverContent>
        </Popover>
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
                  {/* Lock dropdown if user is operator */}
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={operatorsLoading || (userProfile?.role === 'operator' && userProfile.id === field.value)}
                  >
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
                      {operations.map(op => {
                        const duration = getDurationInMinutes(selectedHourlyRange);
                        const smv = op.smv;
                        const targetQuantity = duration > 0 && smv > 0 ? Math.floor((duration * 60) / smv) : 0;
                        return (
                          <SelectItem key={op.id} value={op.id}>
                            {op.name} - {targetQuantity} pcs
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
