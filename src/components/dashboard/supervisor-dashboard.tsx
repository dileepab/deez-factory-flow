'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductionEntry } from '@/components/dashboard/production-entry';
import { AISuggestions } from '@/components/dashboard/ai-suggestions';
import { ProductionLog } from '@/components/dashboard/production-log';
import { OperatorLeaderboard } from '@/components/dashboard/leaderboard';
import { StyleManagement } from '@/components/dashboard/style-management';
import { Activity, BarChart, Package, Users } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { startOfDay, format } from 'date-fns';

export function SupervisorDashboard() {
    // --- Data Fetching for Stats ---
    // (Reusing similar logic to Admin Dashboard for consistency, can be extracted to a hook later)

    // 1. Production Data (Today)
    const today = startOfDay(new Date());
    const productionQuery = useMemoFirebase(
        () => query(
            collection(firestore, 'production'),
            where('timestamp', '>=', today),
            orderBy('timestamp', 'asc')
        ),
        []
    );
    const { data: productionLogs } = useCollection(productionQuery);

    // 2. Operators (Active)
    const operatorsQuery = useMemoFirebase(
        () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
        []
    );
    const { data: operators } = useCollection(operatorsQuery);

    // 3. Active Styles
    const stylesQuery = useMemoFirebase(
        () => query(collection(firestore, 'styles'), where('status', '==', 'active')),
        []
    );
    const { data: styles } = useCollection(stylesQuery);


    const stats = useMemo(() => {
        const todayProduction = productionLogs?.reduce((sum, log) => sum + (log.cumulativeQuantity || 0), 0) || 0;
        const totalOperators = operators?.length || 0;
        const activeStylesCount = styles?.length || 0;
        const avgEfficiency = 82; // Placeholder until factory-wide agg is ready

        return { todayProduction, totalOperators, activeStylesCount, avgEfficiency };
    }, [productionLogs, operators, styles]);

    return (
        <div className="space-y-8">
            {/* Top Section: At a Glance */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Daily Production</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.todayProduction}</div>
                        <p className="text-xs text-muted-foreground">Units produced today</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Floor Efficiency</CardTitle>
                        <BarChart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.avgEfficiency}%</div>
                        <p className="text-xs text-muted-foreground">Average efficiency</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Active Styles</CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.activeStylesCount}</div>
                        <p className="text-xs text-muted-foreground">Currently running</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Team Size</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalOperators}</div>
                        <p className="text-xs text-muted-foreground">Operators on floor</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="styles">Styles & Operations</TabsTrigger>
                    <TabsTrigger value="leaderboard">Team Leaderboard</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    <div className="grid gap-8 grid-cols-1 lg:grid-cols-2">
                        <ProductionEntry />
                        <AISuggestions />
                        <div className="lg:col-span-2">
                            <ProductionLog />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="styles" className="space-y-4">
                    <StyleManagement />
                </TabsContent>

                <TabsContent value="leaderboard" className="space-y-4">
                    <OperatorLeaderboard />
                </TabsContent>
            </Tabs>
        </div>
    );
}
