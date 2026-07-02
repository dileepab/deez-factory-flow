import { describe, expect, it } from 'vitest';
import {
    calculateFactorySalaryProjection,
    getFactorySalarySettings,
} from './factory-salary';

describe('factory salary planning', () => {
    it('calculates the 22-day break-even target from default salary settings', () => {
        const settings = getFactorySalarySettings({
            targetSalaryLKR: 40000,
            attendanceBonusLKR: 3000,
            workingDaysPerMonth: 22,
            laborValuePerDressLKR: 230,
        });

        const projection = calculateFactorySalaryProjection({
            operatorCount: 4,
            plannedDailyOutput: 48,
            settings,
        });

        expect(projection.monthlyLaborCostLKR).toBe(240000);
        expect(projection.monthlyDressTarget).toBe(1044);
        expect(projection.dailyDressTarget).toBe(48);
        expect(projection.dressesPerOperatorPerDay).toBe(12);
        expect(Math.round(projection.targetSmvAtPlanningEfficiency)).toBe(24);
        expect(projection.targetStatus).toBe('meets-target');
    });

    it('projects a team bonus when planned output exceeds salary break-even', () => {
        const settings = getFactorySalarySettings({
            targetSalaryLKR: 40000,
            attendanceBonusLKR: 3000,
            workingDaysPerMonth: 22,
            laborValuePerDressLKR: 230,
            teamProductionBonusCapLKR: 8000,
            individualPerformanceBonusCapLKR: 3000,
        });

        const projection = calculateFactorySalaryProjection({
            operatorCount: 4,
            plannedDailyOutput: 60,
            settings,
        });

        expect(projection.targetStatus).toBe('healthy-margin');
        expect(projection.teamBonusPerOperatorLKR).toBe(8000);
        expect(projection.maxOperatorMonthlyPayLKR).toBe(51000);
    });

    it('normalizes incomplete configuration with practical defaults', () => {
        const settings = getFactorySalarySettings(null);

        expect(settings.operatorTargetSalaryLKR).toBe(40000);
        expect(settings.operatorBaseSalaryLKR).toBe(37000);
        expect(settings.attendanceBonusLKR).toBe(3000);
        expect(settings.laborValuePerDressLKR).toBe(230);
        expect(settings.averageSmvPerDress).toBe(24);
    });
});

