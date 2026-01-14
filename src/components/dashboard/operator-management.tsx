import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, Eye, Edit } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { useConfiguration } from '@/firebase/firestore/use-configuration';
import { collection, query, where, updateDoc, doc } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import type { AnyUser, Operator, Configuration } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { SalarySlip } from '@/components/dashboard/salary-slip';
import { calculateMonthlySalary } from '@/lib/utils';
import { MultiSelect, Option } from '@/components/ui/multi-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MACHINE_TYPES } from '@/lib/constants';
import { useToast } from '@/hooks/use-toast';

export function OperatorManagement() {
  const { toast } = useToast();
  const { data: config } = useConfiguration();
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);
  const [isSalaryDialogOpen, setIsSalaryDialogOpen] = useState(false);

  // Edit State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [efficiencyRating, setEfficiencyRating] = useState<number>(100);
  const [isSaving, setIsSaving] = useState(false);

  const machineOptions: Option[] = MACHINE_TYPES.map(m => ({ value: m, label: m }));

  const operatorsQuery = useMemoFirebase(
    () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
    []
  );
  const { data: operators, isLoading: operatorsLoading } =
    useCollection<AnyUser>(operatorsQuery);

  const handleViewSalary = (operator: AnyUser) => {
    setSelectedOperator(operator as Operator);
    setIsSalaryDialogOpen(true);
  };

  const handleEdit = (operator: AnyUser) => {
    const op = operator as Operator;
    setEditingOperator(op);
    setSelectedSkills(op.skills || []);
    setEfficiencyRating(op.efficiencyRating || 100);
    setIsEditOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOperator) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(firestore, 'users', editingOperator.id), {
        skills: selectedSkills,
        efficiencyRating: efficiencyRating
      });
      toast({ title: "Operator Updated", description: "Skills and efficiency rating saved." });
      setIsEditOpen(false);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: "Failed to update operator." });
    } finally {
      setIsSaving(false);
    }
  };

  const getOperatorSalary = (operator: AnyUser) => {
    if (!config) return 0;
    const totalEarnedMinutes = operator.monthlyStats?.[new Date().toISOString().slice(0, 7)]?.totalEarnedMinutes || operator.earnedMinutes || 0;
    const daysAbsent = 0;

    const { finalSalary } = calculateMonthlySalary(
      totalEarnedMinutes,
      daysAbsent,
      config.minuteValueLKR,
      config.attendanceBonusLKR
    );
    return finalSalary;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(amount);
  };

  return (
    <>
      <Card id="operators">
        <CardHeader>
          <CardTitle>Operator Management</CardTitle>
          <CardDescription>Manage operator profiles, skills, and payroll.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Est. Salary</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operatorsLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    <div className="flex justify-center items-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary mr-2" />
                      Loading operators...
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {operators?.map(operator => (
                <TableRow key={operator.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{operator.name}</span>
                      <span className="text-xs text-muted-foreground">{operator.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(operator as Operator).skills?.map(s => (
                        <Badge key={s} variant="secondary" className="px-1 py-0 text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{(operator as Operator).efficiencyRating || 100}%</TableCell>
                  <TableCell>{config ? formatCurrency(getOperatorSalary(operator)) : '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(operator)} title="Edit Skills">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleViewSalary(operator)} title="View Salary Slip">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isSalaryDialogOpen} onOpenChange={setIsSalaryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Salary Details: {selectedOperator?.name}</DialogTitle>
          </DialogHeader>
          {selectedOperator && config && (
            <SalarySlip
              operator={selectedOperator}
              totalEarnedMinutes={selectedOperator.monthlyStats?.[new Date().toISOString().slice(0, 7)]?.totalEarnedMinutes || selectedOperator.earnedMinutes || 0}
              daysAbsent={0}
              config={config}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <form onSubmit={handleSaveEdit}>
            <DialogHeader>
              <DialogTitle>Edit Operator: {editingOperator?.name}</DialogTitle>
              <DialogDescription>Update skills and efficiency rating.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Machine Skills</Label>
                <MultiSelect
                  options={machineOptions}
                  selected={selectedSkills}
                  onChange={setSelectedSkills}
                  placeholder="Select machine types..."
                />
              </div>
              <div className="grid gap-2">
                <Label>Efficiency Rating (%)</Label>
                <Input
                  type="number"
                  min="1"
                  max="200"
                  value={efficiencyRating}
                  onChange={(e) => setEfficiencyRating(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Used for production planning calculations.</p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setIsEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
