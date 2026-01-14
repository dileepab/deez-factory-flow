'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductionEntry as ProductionEntryForm } from '@/components/dashboard/production-entry';
import { AISuggestions } from '@/components/dashboard/ai-suggestions';
import { ProductionLog } from '@/components/dashboard/production-log';
import { OperatorLeaderboard } from '@/components/dashboard/leaderboard';
import { StyleManagement } from '@/components/dashboard/style-management';
import { Activity, BarChart, Package, Users } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { HourlyEfficiencyChart } from '@/components/dashboard/hourly-efficiency-chart';
import { BottleneckAnalysis } from '@/components/dashboard/bottleneck-analysis';
import { ProductionPlanner } from '@/components/dashboard/production-planner';
import { useConfiguration } from '@/firebase/firestore/use-configuration';
import { startOfDay, format, startOfMonth } from 'date-fns';

import type { GarmentStyle, ProductionEntry } from '@/lib/types';

export function SupervisorDashboard() {
    const { data: config } = useConfiguration();
    // --- Data Fetching for Stats ---
    // (Reusing similar logic to Admin Dashboard for consistency, can be extracted to a hook later)

    // 1. Production Data (This Month)
    const monthStart = startOfMonth(new Date());
    const productionQuery = useMemoFirebase(
        () => query(
            collection(firestore, 'production'),
            where('timestamp', '>=', monthStart),
            orderBy('timestamp', 'asc')
        ),
        []
    );
    const { data: productionLogs } = useCollection<ProductionEntry>(productionQuery);

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
    const { data: styles } = useCollection<GarmentStyle>(stylesQuery);


    const stats = useMemo(() => {
        const totalOperators = operators?.length || 0;
        const activeStylesCount = styles?.length || 0;
        const availableMinutes = config?.availableMinutesPerDay || 480;

        let todayProd = 0;
        let monthProd = 0;
        let todayEarned = 0;
        let monthEarned = 0;

        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const uniqueDays = new Set<string>();

        productionLogs?.forEach(log => {
            const logDateStr = format(log.timestamp.toDate(), 'yyyy-MM-dd');
            uniqueDays.add(logDateStr);
            const isToday = logDateStr === todayStr;

            const style = styles?.find(s => s.id === log.styleId);
            if (!style) return;

            const styleTotalSmv = style.operations.reduce((acc, op) => acc + (Number(op.smv) || 0), 0);
            const operation = style.operations.find(op => op.id === log.operationId);
            const opSmvSeconds = Number(operation?.smv) || 0;
            const opSmvMinutes = opSmvSeconds / 60;

            if (styleTotalSmv > 0) {
                const eq = ((log.cumulativeQuantity || 0) * opSmvSeconds) / styleTotalSmv;
                monthProd += eq;
                if (isToday) todayProd += eq;
            }

            const earned = (log.cumulativeQuantity || 0) * opSmvMinutes;
            monthEarned += earned;
            if (isToday) todayEarned += earned;
        });

        const dailyCapacity = totalOperators * availableMinutes;
        const todayEfficiency = dailyCapacity > 0 ? (todayEarned / dailyCapacity) * 100 : 0;

        const workedDays = uniqueDays.size || 1;
        const monthCapacity = dailyCapacity * workedDays;
        const monthEfficiency = monthCapacity > 0 ? (monthEarned / monthCapacity) * 100 : 0;

        return {
            totalOperators,
            activeStylesCount,
            todayProduction: todayProd,
            monthProduction: monthProd,
            todayEfficiency,
            monthEfficiency
        };
    }, [productionLogs, operators, styles, config]);

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
                        <div className="text-2xl font-bold">{stats.todayProduction.toFixed(1)}</div>
                        <p className="text-xs text-muted-foreground">Today (Equivalent)</p>
                        <div className="pt-2 mt-2 border-t text-sm font-medium text-muted-foreground">
                            Month: {Math.round(stats.monthProduction)} units
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Floor Efficiency</CardTitle>
                        <BarChart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{Math.round(stats.todayEfficiency)}%</div>
                        <p className="text-xs text-muted-foreground">Efficiency (Today)</p>
                        <div className="pt-2 mt-2 border-t text-sm font-medium text-muted-foreground">
                            Month: {Math.round(stats.monthEfficiency)}%
                        </div>
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
                    <TabsTrigger value="planning">Production Planning</TabsTrigger>
                    <TabsTrigger value="styles">Styles & Operations</TabsTrigger>
                    <TabsTrigger value="leaderboard">Team Leaderboard</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
                        <HourlyEfficiencyChart className="lg:col-span-4" />
                        <BottleneckAnalysis className="lg:col-span-3" />
                    </div>
                    <div className="grid gap-8 grid-cols-1 lg:grid-cols-2">
                        <ProductionEntryForm />
                        <AISuggestions />
                        <div className="lg:col-span-2">
                            <ProductionLog />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="planning" className="space-y-4">
                    <ProductionPlanner />
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
