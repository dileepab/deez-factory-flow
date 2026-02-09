
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

interface QuickLogModalProps {
    isOpen: boolean;
    onClose: () => void;
    segment: any; // Using any for simplicity as segment structure is internal to timeline, roughly { name, count, start, end, ... }
    operatorId: string;
    styleId: string; // The style ID relevant to this segment
    opId: string; // The operation ID
}

export function QuickLogModal({ isOpen, onClose, segment, operatorId, styleId, opId }: QuickLogModalProps) {
    const { toast } = useToast();
    const [quantity, setQuantity] = useState<number>(0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen && segment) {
            setQuantity(Math.round(segment.count || 0));
        }
    }, [isOpen, segment]);

    const handleSave = async () => {
        if (!segment) return;
        setIsSubmitting(true);
        try {
            // Reconstruct hourly range string roughly from segment start/end
            // Segment start/end are wall minutes (e.g. 7:30 is 450)
            // We need "HH:MM - HH:MM"
            const startM = segment.start; // Wall minutes
            const endM = segment.end;

            // Shift start at 7:30 AM = 450 minutes
            // Wait, segment.start/end IS wall minutes from mapWorkStart/mapWorkEnd in DailyTimeline.
            // Let's verify DailyTimeline logic. 
            // mapWorkStart returns "workMin + 60" etc. 7:30 is 450.
            // If workMin is 0, mapWorkStart returns 0.
            // Ah, mapWorkStart maps Work Minutes (0) to Wall Minutes FROM 7:30? No.
            // DailyTimeline: const mapWorkStart = (workMin: number) => { if (workMin < 165) return workMin; ... }
            // So if workMin is 0, it returns 0.
            // formatTime does: (SHIFT_START_HOUR * 60) + minutes. 
            // So 'minutes' is offset from 7:30.

            // So here in QuickLogModal, startM is offset from 7:30.
            // But we want to format it as HH:MM of the day.
            // So we need to add 450 (7.5 * 60).

            const SHIFT_OFFSET = 450;

            const formatM = (minutesFromShiftStart: number) => {
                const totalM = minutesFromShiftStart + SHIFT_OFFSET;
                const h = Math.floor(totalM / 60);
                const m = Math.floor(totalM % 60);
                return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            };

            const rangeStr = `${formatM(startM)} - ${formatM(endM)}`;
            const workedMinutes = endM - startM;

            const payload = {
                operatorId,
                styleId,
                operationId: opId,
                hourlyRange: rangeStr,
                quantity: Number(quantity),
                reworkQuantity: 0,
                workedMinutes,
                date: new Date().toISOString(),
                startTime: startM // Send start time (wall minutes from timeline) to identify segment
            };

            const response = await fetch('/api/log-production', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error("Failed to save");

            toast({
                title: "Saved!",
                description: `Logged ${quantity} pcs for ${segment.name}`,
            });
            onClose();
        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Could not save production log."
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!segment) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Quick Log Production</DialogTitle>
                    <DialogDescription>
                        Confirm completion for <strong>{segment.name}</strong>.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="qty" className="text-right">
                            Quantity
                        </Label>
                        <Input
                            id="qty"
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(Number(e.target.value))}
                            className="col-span-3"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button onClick={handleSave} disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Log
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
