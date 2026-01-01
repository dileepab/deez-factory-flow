'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/auth-provider';
import { useConfiguration } from '@/firebase/firestore/use-configuration';
import { doc, updateDoc } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, AlertCircle } from 'lucide-react';
import type { Configuration } from '@/lib/types';

import { format } from "date-fns"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"

export function ConfigurationManagement() {
  const { data: config, isLoading: isConfigLoading, error } = useConfiguration();

  const [formData, setFormData] = useState<Partial<Configuration>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  useEffect(() => {
    if (config) {
      setFormData(config);
    }
  }, [config]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    // Handle the generic inputs
    const isNumber = e.target.getAttribute('type') === 'number';
    setFormData(prev => ({ ...prev, [id]: isNumber ? Number(value) : value }));
  };

  const addHoliday = (date: Date | undefined) => {
    if (!date) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    const currentHolidays = formData.holidays || [];

    if (!currentHolidays.includes(dateStr)) {
      const sortedHolidays = [...currentHolidays, dateStr].sort();
      setFormData(prev => ({ ...prev, holidays: sortedHolidays }));
    }
    setIsCalendarOpen(false);
  };

  const removeHoliday = (dateStr: string) => {
    setFormData(prev => ({
      ...prev,
      holidays: (prev.holidays || []).filter(h => h !== dateStr)
    }));
  };

  const handleSave = async () => {
    if (!firestore || !config) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const configRef = doc(firestore, 'configuration', 'main');
      await updateDoc(configRef, formData);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000); // Hide message after 3s
    } catch (e: any) {
      console.error("Error saving configuration:", e);
      setSaveError('Failed to save settings. Please check the console for details.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isConfigLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Loading application settings...</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center items-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Error</CardTitle>
          <CardDescription className="text-destructive">
            Could not load application settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center text-destructive">
          <AlertCircle className="mr-2 h-5 w-5" />
          <p>{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="settings">
      <CardHeader>
        <CardTitle>Application Settings</CardTitle>
        <CardDescription>Manage global settings for salary calculation and holidays. Changes will apply to all users.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="minuteValueLKR">Minute Value (LKR)</Label>
            <Input id="minuteValueLKR" type="number" value={formData.minuteValueLKR || ''} onChange={handleInputChange} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="attendanceBonusLKR">Attendance Bonus (LKR)</Label>
            <Input id="attendanceBonusLKR" type="number" value={formData.attendanceBonusLKR || ''} onChange={handleInputChange} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="availableMinutesPerDay">Available Minutes per Day</Label>
            <Input id="availableMinutesPerDay" type="number" value={formData.availableMinutesPerDay || ''} onChange={handleInputChange} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="targetSalaryLKR">Target Salary (LKR)</Label>
            <Input id="targetSalaryLKR" type="number" value={formData.targetSalaryLKR || ''} onChange={handleInputChange} />
          </div>
        </div>
        <div className="space-y-3">
          <Label>Holidays</Label>
          <div className="flex flex-col gap-4">
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-[240px] pl-3 text-left font-normal",
                    !formData.holidays && "text-muted-foreground"
                  )}
                >
                  {formData.holidays && formData.holidays.length > 0 ? (
                    <span>Add Holiday</span>
                  ) : (
                    <span>Pick a date</span>
                  )}
                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={undefined}
                  onSelect={addHoliday}
                  disabled={(date) =>
                    date < new Date("1900-01-01")
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <div className="flex flex-wrap gap-2 min-h-[40px] p-2 border rounded-md">
              {!formData.holidays || formData.holidays.length === 0 ? (
                <span className="text-sm text-muted-foreground">No holidays added.</span>
              ) : (
                formData.holidays.map((dateStr) => (
                  <Badge key={dateStr} variant="secondary" className="pl-3 pr-1 py-1 flex items-center gap-1 group">
                    {dateStr}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 rounded-full p-0 py-0 text-muted-foreground hover:text-foreground hover:bg-transparent"
                      onClick={() => removeHoliday(dateStr)}
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove {dateStr}</span>
                    </Button>
                  </Badge>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">Select a date from the calendar to add it as a holiday. Click 'x' to remove.</p>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <div className="text-sm space-x-2">
          {isSaving && <Loader2 className="inline-block h-4 w-4 animate-spin mr-1" />}
          {saveSuccess && <span className="text-green-600">Settings saved successfully!</span>}
          {saveError && <span className="text-destructive">{saveError}</span>}
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Settings'}
        </Button>
      </CardFooter>
    </Card>
  );
}
