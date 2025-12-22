import { TARGET_SALARY_LKR, WORKING_DAYS_PER_MONTH, AVAILABLE_MINUTES_PER_DAY } from './constants';

export function calculateDailyEarnings(earnedMinutes: number, hasAttended: boolean, attendanceBonus: number) {
  const dailyTargetSalary = TARGET_SALARY_LKR / WORKING_DAYS_PER_MONTH;
  
  // Efficiency for salary calculation purposes
  const efficiency = earnedMinutes / AVAILABLE_MINUTES_PER_DAY;
  
  // Base pay is the target salary portion for the day
  const basePay = dailyTargetSalary;

  // Piece rate earnings are a multiplier on the base pay based on efficiency
  // Operator earns base pay at 100% efficiency. Above that is a bonus.
  const pieceRateEarnings = basePay * efficiency;
  
  const total = pieceRateEarnings + (hasAttended ? attendanceBonus / WORKING_DAYS_PER_MONTH : 0);
  
  return {
    basePay: dailyTargetSalary,
    pieceRateEarnings: pieceRateEarnings,
    attendanceBonus: hasAttended ? attendanceBonus / WORKING_DAYS_PER_MONTH : 0,
    total,
  };
}
