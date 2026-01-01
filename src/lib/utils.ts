'use client';

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Calculates the actual number of working days in a given month, excluding weekends and public holidays.
 *
 * @param year - The full year (e.g., 2025).
 * @param month - The month, 1-indexed (1 for January, 12 for December).
 * @param holidays - An array of holiday date strings in 'YYYY-MM-DD' format.
 * @returns The total number of working days in the month.
 */
export function getActualWorkingDays(
  year: number, 
  month: number, 
  holidays: string[] = []
): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;

  const holidaySet = new Set(
    holidays
      .map(h => new Date(`${h}T00:00:00`))
      .filter(d => d.getFullYear() === year && d.getMonth() === month - 1)
      .map(d => d.getDate())
  );

  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month - 1, day);
    const dayOfWeek = currentDate.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isHoliday = holidaySet.has(day);

    if (isWeekday && !isHoliday) {
      workingDays++;
    }
  }

  return workingDays;
}

/**
 * Calculates the attendance bonus based on the number of days a worker was absent.
 *
 * @param daysAbsent - The total number of days the worker was absent in a month.
 * @param attendanceBonusLKR - The full bonus amount for perfect attendance.
 * @returns The calculated attendance bonus in LKR.
 */
export function calculateAttendanceBonus(
  daysAbsent: number, 
  attendanceBonusLKR: number
): number {
  if (daysAbsent < 0) return 0;
  if (daysAbsent === 0) return attendanceBonusLKR;
  if (daysAbsent === 1) return 2000; // This could also be a configurable value
  return 0;
}

/**
 * Calculates an operator's final monthly salary based on their total earned minutes and attendance.
 *
 * @param totalEarnedMinutes - The sum of all SAM values for work completed in the month.
 * @param daysAbsent - The total number of days the worker was absent in a month.
 * @param minuteValueLKR - The value of one earned minute in LKR.
 * @param attendanceBonusLKR - The full bonus amount for perfect attendance.
 * @returns An object containing the final salary, the base pay, and the attendance bonus.
 */
export function calculateMonthlySalary(
  totalEarnedMinutes: number,
  daysAbsent: number,
  minuteValueLKR: number,
  attendanceBonusLKR: number
): { finalSalary: number; basePay: number; attendanceBonus: number } {
  const basePay = totalEarnedMinutes * minuteValueLKR;
  const attendanceBonus = calculateAttendanceBonus(daysAbsent, attendanceBonusLKR);
  const finalSalary = basePay + attendanceBonus;

  return {
    finalSalary,
    basePay,
    attendanceBonus,
  };
}
