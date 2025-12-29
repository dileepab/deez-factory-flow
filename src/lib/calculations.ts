import { TARGET_SALARY_LKR, WORKING_DAYS_PER_MONTH, AVAILABLE_MINUTES_PER_DAY } from './constants';

export function calculateDailyEarnings(earnedMinutes: number, hasAttended: boolean, attendanceBonus: number) {
  if (!hasAttended) {
    return { basePay: 0, incentivePay: 0, bonusPay: 0, attendanceBonus: 0, total: 0 };
  }

  const dailyTargetSalary = TARGET_SALARY_LKR / WORKING_DAYS_PER_MONTH;
  const dailyAttendanceBonus = attendanceBonus / WORKING_DAYS_PER_MONTH;

  const basePay = dailyTargetSalary * 0.5; // 50% of target salary is guaranteed
  const incentivePayTarget = dailyTargetSalary * 0.5; // The other 50% is performance-based

  const efficiency = earnedMinutes / AVAILABLE_MINUTES_PER_DAY;

  let incentivePay = 0;
  let bonusPay = 0;

  if (efficiency <= 1) {
    // Earn the incentive portion proportionally up to 100% efficiency
    incentivePay = incentivePayTarget * efficiency;
  } else {
    // Earn the full incentive pay, plus a bonus for exceeding 100%
    incentivePay = incentivePayTarget;
    const extraEfficiency = efficiency - 1;
    // Bonus is paid at 2x the rate of the incentive pay
    bonusPay = (dailyTargetSalary * extraEfficiency) * 2; 
  }

  const total = basePay + incentivePay + bonusPay + dailyAttendanceBonus;

  return {
    basePay,
    incentivePay,
    bonusPay,
    attendanceBonus: dailyAttendanceBonus,
    total,
  };
}

export function calculateMonthlyEfficiency(totalEarnedMinutes: number, totalWorkedMinutes: number): number {
  if (totalWorkedMinutes <= 0) {
    return 0;
  }
  return (totalEarnedMinutes / totalWorkedMinutes) * 100;
}

export function calculateWorkedMinutes(daysWorked: number): number {
  return daysWorked * AVAILABLE_MINUTES_PER_DAY;
}
