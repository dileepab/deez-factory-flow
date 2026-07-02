import type { Configuration } from '@/lib/types';

export type FactorySalarySettings = {
    operatorTargetSalaryLKR: number;
    operatorBaseSalaryLKR: number;
    attendanceBonusLKR: number;
    helperMonthlySalaryLKR: number;
    helperCount: number;
    cutterMonthlySalaryLKR: number;
    cutterCount: number;
    laborValuePerDressLKR: number;
    workingDaysPerMonth: number;
    availableMinutesPerDay: number;
    averageSmvPerDress: number;
    planningEfficiencyPercent: number;
    teamProductionBonusCapLKR: number;
    individualPerformanceBonusCapLKR: number;
    attendanceGraceMinutes: number;
};

export type FactorySalaryProjection = {
    operatorCount: number;
    monthlyLaborCostLKR: number;
    monthlyDressTarget: number;
    dailyDressTarget: number;
    dressesPerOperatorPerDay: number;
    targetSmvAtFullEfficiency: number;
    targetSmvAtPlanningEfficiency: number;
    plannedDailyOutput: number;
    plannedMonthlyOutput: number;
    plannedMonthlyValueLKR: number;
    plannedSurplusDressesPerDay: number;
    plannedSurplusValueLKR: number;
    plannedDressesPerOperatorPerDay: number;
    teamBonusPerOperatorLKR: number;
    maxOperatorMonthlyPayLKR: number;
    targetStatus: 'missing-plan' | 'below-target' | 'meets-target' | 'healthy-margin';
};

export const DEFAULT_FACTORY_SALARY_SETTINGS: FactorySalarySettings = {
    operatorTargetSalaryLKR: 40000,
    operatorBaseSalaryLKR: 37000,
    attendanceBonusLKR: 3000,
    helperMonthlySalaryLKR: 35000,
    helperCount: 1,
    cutterMonthlySalaryLKR: 45000,
    cutterCount: 1,
    laborValuePerDressLKR: 230,
    workingDaysPerMonth: 22,
    availableMinutesPerDay: 480,
    averageSmvPerDress: 24,
    planningEfficiencyPercent: 60,
    teamProductionBonusCapLKR: 8000,
    individualPerformanceBonusCapLKR: 3000,
    attendanceGraceMinutes: 15,
};

const positiveNumber = (value: unknown, fallback: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
    return value;
};

const nonNegativeNumber = (value: unknown, fallback: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
    return value;
};

export function getFactorySalarySettings(config?: Partial<Configuration> | null): FactorySalarySettings {
    const operatorTargetSalaryLKR = positiveNumber(
        config?.targetSalaryLKR,
        DEFAULT_FACTORY_SALARY_SETTINGS.operatorTargetSalaryLKR
    );
    const attendanceBonusLKR = nonNegativeNumber(
        config?.attendanceBonusLKR,
        DEFAULT_FACTORY_SALARY_SETTINGS.attendanceBonusLKR
    );

    return {
        operatorTargetSalaryLKR,
        attendanceBonusLKR,
        operatorBaseSalaryLKR: nonNegativeNumber(
            config?.operatorBaseSalaryLKR,
            Math.max(0, operatorTargetSalaryLKR - attendanceBonusLKR)
        ),
        helperMonthlySalaryLKR: positiveNumber(
            config?.helperMonthlySalaryLKR,
            DEFAULT_FACTORY_SALARY_SETTINGS.helperMonthlySalaryLKR
        ),
        helperCount: Math.floor(nonNegativeNumber(config?.helperCount, DEFAULT_FACTORY_SALARY_SETTINGS.helperCount)),
        cutterMonthlySalaryLKR: positiveNumber(
            config?.cutterMonthlySalaryLKR,
            DEFAULT_FACTORY_SALARY_SETTINGS.cutterMonthlySalaryLKR
        ),
        cutterCount: Math.floor(nonNegativeNumber(config?.cutterCount, DEFAULT_FACTORY_SALARY_SETTINGS.cutterCount)),
        laborValuePerDressLKR: positiveNumber(
            config?.laborValuePerDressLKR,
            DEFAULT_FACTORY_SALARY_SETTINGS.laborValuePerDressLKR
        ),
        workingDaysPerMonth: Math.floor(positiveNumber(
            config?.workingDaysPerMonth,
            DEFAULT_FACTORY_SALARY_SETTINGS.workingDaysPerMonth
        )),
        availableMinutesPerDay: positiveNumber(
            config?.availableMinutesPerDay,
            DEFAULT_FACTORY_SALARY_SETTINGS.availableMinutesPerDay
        ),
        averageSmvPerDress: positiveNumber(
            config?.averageSmvPerDress,
            DEFAULT_FACTORY_SALARY_SETTINGS.averageSmvPerDress
        ),
        planningEfficiencyPercent: positiveNumber(
            config?.planningEfficiencyPercent,
            DEFAULT_FACTORY_SALARY_SETTINGS.planningEfficiencyPercent
        ),
        teamProductionBonusCapLKR: nonNegativeNumber(
            config?.teamProductionBonusCapLKR,
            DEFAULT_FACTORY_SALARY_SETTINGS.teamProductionBonusCapLKR
        ),
        individualPerformanceBonusCapLKR: nonNegativeNumber(
            config?.individualPerformanceBonusCapLKR,
            DEFAULT_FACTORY_SALARY_SETTINGS.individualPerformanceBonusCapLKR
        ),
        attendanceGraceMinutes: nonNegativeNumber(
            config?.attendanceGraceMinutes,
            DEFAULT_FACTORY_SALARY_SETTINGS.attendanceGraceMinutes
        ),
    };
}

export function calculateFactorySalaryProjection(params: {
    operatorCount: number;
    plannedDailyOutput?: number;
    settings: FactorySalarySettings;
}): FactorySalaryProjection {
    const operatorCount = Math.max(1, Math.floor(params.operatorCount));
    const plannedDailyOutput = Math.max(0, Math.floor(params.plannedDailyOutput || 0));
    const { settings } = params;

    const monthlyLaborCostLKR =
        (operatorCount * settings.operatorTargetSalaryLKR) +
        (settings.helperCount * settings.helperMonthlySalaryLKR) +
        (settings.cutterCount * settings.cutterMonthlySalaryLKR);
    const monthlyDressTarget = Math.ceil(monthlyLaborCostLKR / settings.laborValuePerDressLKR);
    const dailyDressTarget = Math.ceil(monthlyDressTarget / settings.workingDaysPerMonth);
    const dressesPerOperatorPerDay = dailyDressTarget / operatorCount;
    const targetSmvAtFullEfficiency = (operatorCount * settings.availableMinutesPerDay) / Math.max(1, dailyDressTarget);
    const planningEfficiency = settings.planningEfficiencyPercent / 100;
    const targetSmvAtPlanningEfficiency = targetSmvAtFullEfficiency * planningEfficiency;
    const plannedMonthlyOutput = plannedDailyOutput * settings.workingDaysPerMonth;
    const plannedMonthlyValueLKR = plannedMonthlyOutput * settings.laborValuePerDressLKR;
    const plannedSurplusDressesPerDay = plannedDailyOutput - dailyDressTarget;
    const plannedSurplusValueLKR = Math.max(0, plannedMonthlyValueLKR - monthlyLaborCostLKR);
    const plannedDressesPerOperatorPerDay = plannedDailyOutput / operatorCount;
    const teamBonusPerOperatorLKR = Math.min(
        settings.teamProductionBonusCapLKR,
        plannedSurplusValueLKR / operatorCount
    );
    const maxOperatorMonthlyPayLKR =
        settings.operatorBaseSalaryLKR +
        settings.attendanceBonusLKR +
        teamBonusPerOperatorLKR +
        settings.individualPerformanceBonusCapLKR;
    const targetStatus =
        plannedDailyOutput <= 0
            ? 'missing-plan'
            : plannedDailyOutput < dailyDressTarget
                ? 'below-target'
                : plannedDailyOutput >= Math.ceil(dailyDressTarget * 1.15)
                    ? 'healthy-margin'
                    : 'meets-target';

    return {
        operatorCount,
        monthlyLaborCostLKR,
        monthlyDressTarget,
        dailyDressTarget,
        dressesPerOperatorPerDay,
        targetSmvAtFullEfficiency,
        targetSmvAtPlanningEfficiency,
        plannedDailyOutput,
        plannedMonthlyOutput,
        plannedMonthlyValueLKR,
        plannedSurplusDressesPerDay,
        plannedSurplusValueLKR,
        plannedDressesPerOperatorPerDay,
        teamBonusPerOperatorLKR,
        maxOperatorMonthlyPayLKR,
        targetStatus,
    };
}

