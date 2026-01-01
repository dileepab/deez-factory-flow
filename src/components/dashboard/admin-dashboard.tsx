'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OperatorLeaderboard } from '@/components/dashboard/leaderboard';
import { StyleManagement } from '@/components/dashboard/style-management';
import { OperatorManagement } from '@/components/dashboard/operator-management';
import { SupervisorManagement } from '@/components/dashboard/supervisor-management';
import { ProductionEntry } from '@/components/dashboard/production-entry';
import { BarChart, Activity, Users, Package } from 'lucide-react';
import { useCollection } from '@/firebase/firestore/use-collection';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { firestore } from '@/firebase/client';
import { useMemoFirebase } from '@/firebase/use-memo-firebase';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { startOfDay, subDays, format } from 'date-fns';

export function AdminDashboard() {
    // --- Data Fetching ---

    // 1. Operators (for total count)
    const operatorsQuery = useMemoFirebase(
        () => query(collection(firestore, 'users'), where('role', '==', 'operator')),
        []
    );
    const { data: operators } = useCollection(operatorsQuery);

    // 2. Active Styles
    const stylesQuery = useMemoFirebase(
        () => query(collection(firestore, 'styles'), where('status', '==', 'active')),
        []
    );
    const { data: styles } = useCollection(stylesQuery);

    // 3. Production Data (Last 7 days for chart)
    // Note: optimized query should ideally rely on a pre-aggregated 'daily_stats' collection.
    // For now, we'll fetch recent production logs. This might be heavy in production!
    const sevenDaysAgo = startOfDay(subDays(new Date(), 7));
    const productionQuery = useMemoFirebase(
        () => query(
            collection(firestore, 'production'),
            where('timestamp', '>=', sevenDaysAgo),
            orderBy('timestamp', 'asc')
        ),
        [] // Dependencies
    );
    const { data: productionLogs } = useCollection(productionQuery);


    // --- Calculations ---

    const stats = useMemo(() => {
        const totalOperators = operators?.length || 0;
        const activeStylesCount = styles?.length || 0;

        // Calculate today's production
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const todayProduction = productionLogs?.filter(log =>
            format(log.timestamp.toDate(), 'yyyy-MM-dd') === todayStr
        ).reduce((sum, log) => sum + (log.cumulativeQuantity || 0), 0) || 0;

        // Calculate Factory Average Efficiency (mock logic for now as it requires complex aggregation)
        // In a real app, this would be an aggregation field on the user or a daily stat doc.
        const avgEfficiency = 78; // Placeholder / Target

        return { totalOperators, activeStylesCount, todayProduction, avgEfficiency };
    }, [operators, styles, productionLogs]);


    const chartData = useMemo(() => {
        if (!productionLogs) return [];

        const dataMap = new Map<string, number>();

        // Initialize last 7 days with 0
        for (let i = 6; i >= 0; i--) {
            const date = format(subDays(new Date(), i), 'MMM dd');
            dataMap.set(date, 0);
        }

        // Fill with actual data
        productionLogs.forEach(log => {
            const date = format(log.timestamp.toDate(), 'MMM dd');
            if (dataMap.has(date)) {
                dataMap.set(date, (dataMap.get(date) || 0) + (log.cumulativeQuantity || 0));
            }
        });

        return Array.from(dataMap.entries()).map(([date, total]) => ({ date, total }));
    }, [productionLogs]);


    return (
        <div className="space-y-8">
            {/* Top Section: At a Glance */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Production</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.todayProduction} units</div>
                        <p className="text-xs text-muted-foreground">Produced today</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Avg. Efficiency</CardTitle>
                        <BarChart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.avgEfficiency}%</div>
                        <p className="text-xs text-muted-foreground">Factory wide average</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Active Styles</CardTitle>
                        <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.activeStylesCount}</div>
                        <p className="text-xs text-muted-foreground">Styles in production</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Operators</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalOperators}</div>
                        <p className="text-xs text-muted-foreground">Registered operators</p>
                    </CardContent>
                </Card>
            </div>

            {/* Middle Section: Chart */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Production Trend</CardTitle>
                        <CardDescription>Daily production output for the last 7 days.</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[300px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={chartData}>
                                    <defs>
                                        <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8} />
                                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                                    <Tooltip />
                                    <Area type="monotone" dataKey="total" stroke="#2563eb" fillOpacity={1} fill="url(#colorTotal)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <OperatorLeaderboard limit={5} className="col-span-3" />
            </div>


            {/* Bottom Section: Management Tools (Tabs) */}
            <Tabs defaultValue="styles" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="styles">Styles</TabsTrigger>
                    <TabsTrigger value="operators">Operators</TabsTrigger>
                    <TabsTrigger value="supervisors">Supervisors</TabsTrigger>
                    <TabsTrigger value="production">Production Entry</TabsTrigger>
                </TabsList>
                <TabsContent value="styles" className="space-y-4">
                    <StyleManagement />
                </TabsContent>
                <TabsContent value="operators" className="space-y-4">
                    <OperatorManagement />
                </TabsContent>
                <TabsContent value="supervisors" className="space-y-4">
                    <SupervisorManagement />
                </TabsContent>
                <TabsContent value="production" className="space-y-4">
                    <ProductionEntry />
                </TabsContent>
            </Tabs>
        </div>
    );
}
