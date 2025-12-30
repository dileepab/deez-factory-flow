'use client';

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { ATTENDANCE_BONUS_LKR, MINUTE_VALUE_LKR } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Calculates the attendance bonus based on the number of days a worker was absent.
 *
 * @param daysAbsent - The total number of days the worker was absent in a month.
 * @returns The calculated attendance bonus in LKR.
 */
export function calculateAttendanceBonus(daysAbsent: number): number {
  if (daysAbsent < 0) {
    return 0; // Should not happen, but as a safeguard.
  }
  if (daysAbsent === 0) {
    return ATTENDANCE_BONUS_LKR;
  }
  if (daysAbsent === 1) {
    return 2000;
  }
  // 2 or more days absent
  return 0;
}

/**
 * Calculates an operator's final monthly salary based on their total earned minutes and attendance.
 *
 * @param totalEarnedMinutes - The sum of all SAM values for work completed in the month.
 * @param daysAbsent - The total number of days the worker was absent in a month.
 * @returns An object containing the final salary, the base pay, and the attendance bonus.
 */
export function calculateMonthlySalary(
  totalEarnedMinutes: number,
  daysAbsent: number
): { finalSalary: number; basePay: number; attendanceBonus: number } {
  const basePay = totalEarnedMinutes * MINUTE_VALUE_LKR;
  const attendanceBonus = calculateAttendanceBonus(daysAbsent);
  const finalSalary = basePay + attendanceBonus;

  return {
    finalSalary,
    basePay,
    attendanceBonus,
  };
}
