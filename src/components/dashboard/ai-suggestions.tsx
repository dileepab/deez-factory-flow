'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Lightbulb, AlertTriangle } from 'lucide-react';
import { getEfficiencyImprovementSuggestions, EfficiencyImprovementSuggestionsOutput } from '@/ai/flows/efficiency-improvement-suggestions';
import { useCollection } from '@/firebase/firestore/use-collection';
import { firestore } from '@/firebase/client';
import { collection, query, where, Timestamp } from 'firebase/firestore';
import { ProductionEntry } from '@/lib/types';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';

export function AISuggestions() {
  const [suggestions, setSuggestions] = useState<EfficiencyImprovementSuggestionsOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const productionQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return query(
      collection(firestore, 'production'),
      where('timestamp', '>=', Timestamp.fromDate(startOfDay))
    );
  }, []);

  const { data: productionEntries, isLoading: dataLoading } = useCollection<ProductionEntry>(productionQuery);

  const fetchSuggestions = async () => {
    if (!productionEntries || productionEntries.length === 0) {
      setSuggestions(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const realTimeData = JSON.stringify(productionEntries);
      const result = await getEfficiencyImprovementSuggestions({ realTimeData, language: 'Sinhala' });
      setSuggestions(result);
    } catch (e) {
      console.error(e);
      setError('AI වෙතින් යෝජනා ලබා ගැනීමට නොහැකි විය. කරුණාකර නැවත උත්සාහ කරන්න.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (productionEntries) {
      fetchSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionEntries]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI බලයෙන් ක්‍රියාත්මක යෝජනා</CardTitle>
        <CardDescription>නිෂ්පාදන කාර්යක්ෂමතාව වැඩි දියුණු කිරීම සඳහා ක්‍රියාකාරී උපදෙස්.</CardDescription>
      </CardHeader>
      <CardContent>
        {(isLoading || dataLoading) && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="ml-2 text-muted-foreground">දත්ත විශ්ලේෂණය කරමින්...</p>
          </div>
        )}

        {!isLoading && !dataLoading && error && (
            <div className="flex flex-col items-center justify-center h-40 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
                <p className="text-destructive">{error}</p>
                <Button onClick={fetchSuggestions} className="mt-4">නැවත උත්සාහ කරන්න</Button>
            </div>
        )}

        {!isLoading && !error && !suggestions && (
           <div className="flex flex-col items-center justify-center h-40 text-center">
                <Lightbulb className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">තවම යෝජනා නොමැත.</p>
                <p className="text-xs text-muted-foreground">තවත් නිෂ්පාදන දත්ත සඳහා රැඳී සිටින්න.</p>
            </div>
        )}

        {!isLoading && !error && suggestions && (
          <div>
            <h4 className="font-semibold mb-2">යෝජනා:</h4>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {suggestions.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
            <h4 className="font-semibold mt-4 mb-2">හේතු දැක්වීම:</h4>
            <p className="text-sm text-muted-foreground">{suggestions.reasoning}</p>
            <Button onClick={fetchSuggestions} className="mt-4 w-full">යෝජනා නැවුම් කරන්න</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
