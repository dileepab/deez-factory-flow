'use client';

import { useState } from 'react';
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

  // Fetch production data from the last 24 hours to use as context for the AI
  const productionQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    return query(
      collection(firestore, 'production'),
      where('timestamp', '>=', Timestamp.fromDate(oneDayAgo))
    );
  }, [firestore]);

  const { data: productionEntries, isLoading: dataLoading } = useCollection<ProductionEntry>(productionQuery);

  const fetchSuggestions = async () => {
    if (!productionEntries) {
      setError('නිෂ්පාදන දත්ත තවමත් ලබා ගත නොහැක. කරුණාකර පසුව නැවත උත්සාහ කරන්න.');
      return;
    }

    if (productionEntries.length === 0) {
        setError('AI සඳහා විශ්ලේෂණය කිරීමට තරම් මෑත කාලීන නිෂ්පාදන දත්ත නොමැත.');
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

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="ml-3 text-muted-foreground">AI යෝජනා ජනනය කරමින්... (මෙයට තත්පර 30ක් පමණ ගත විය හැක)</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-40 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
          <p className="text-destructive font-semibold">දෝෂයක් ඇතිවිය</p>
          <p className="text-sm text-destructive mb-4">{error}</p>
          <Button onClick={fetchSuggestions}>නැවත උත්සාහ කරන්න</Button>
        </div>
      );
    }

    if (suggestions) {
      return (
        <div>
          <h4 className="font-semibold mb-2">යෝජනා:</h4>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {suggestions.suggestions.map((suggestion, index) => (
              <li key={index}>{suggestion}</li>
            ))}
          </ul>
          <h4 className="font-semibold mt-4 mb-2">හේතු දැක්වීම:</h4>
          <p className="text-sm text-muted-foreground">{suggestions.reasoning}</p>
          <Button onClick={fetchSuggestions} className="mt-6 w-full">නව යෝජනා ජනනය කරන්න</Button>
        </div>
      );
    }

    return (
        <div className="flex flex-col items-center justify-center h-40 text-center">
            <Lightbulb className="h-8 w-8 text-primary mb-2" />
            <p className="text-muted-foreground mb-4">නිෂ්පාදන කාර්යක්ෂමතාව වැඩි දියුණු කිරීම සඳහා AI බලයෙන් ක්‍රියාත්මක වන යෝජනා ලබා ගන්න.</p>
            <Button onClick={fetchSuggestions} disabled={dataLoading}>
                {dataLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {dataLoading ? 'නිෂ්පාදන දත්ත ලබා ගනිමින්...' : 'යෝජනා ජනනය කරන්න'}
            </Button>
        </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI බලයෙන් ක්‍රියාත්මක යෝජනා</CardTitle>
        <CardDescription>නිෂ්පාදන කාර්යක්ෂමතාව වැඩි දියුණු කිරීම සඳහා ක්‍රියාකාරී උපදෙස්.</CardDescription>
      </CardHeader>
      <CardContent>
        {renderContent()}
      </CardContent>
    </Card>
  );
}
