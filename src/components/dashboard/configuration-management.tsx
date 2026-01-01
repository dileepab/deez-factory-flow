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

export function ConfigurationManagement() {
  const { data: config, isLoading: isConfigLoading, error } = useConfiguration();
  
  const [formData, setFormData] = useState<Partial<Configuration>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (config) {
      setFormData(config);
    }
  }, [config]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    const isNumber = e.target.getAttribute('type') === 'number';
    setFormData(prev => ({ ...prev, [id]: isNumber ? Number(value) : value }));
  };

  const handleHolidaysChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { value } = e.target;
    // Store as an array of strings, splitting by new line
    setFormData(prev => ({ ...prev, holidays: value.split('\n').map(s => s.trim()).filter(Boolean) }));
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
        <div className="space-y-2">
          <Label htmlFor="holidays">Holidays (YYYY-MM-DD)</Label>
          <Textarea
            id="holidays"
            placeholder="Enter one holiday date per line, e.g., 2025-12-25"
            value={(formData.holidays || []).join('\n')}
            onChange={handleHolidaysChange}
            className="min-h-[120px]"
          />
           <p className="text-xs text-muted-foreground pt-1">Enter each holiday on a new line. Only dates matching the YYYY-MM-DD format will be saved.</p>
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
