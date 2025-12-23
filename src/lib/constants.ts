

export const FIREBASE_AUTH_ERRORS: { [key: string]: string } = {
  'auth/email-already-exists': 'The email address is already in use by another account.',
  'auth/invalid-email': 'The email address is not valid.',
  'auth/operation-not-allowed': 'Email/password accounts are not enabled.',
  'auth/weak-password': 'The password is not strong enough.',
  'auth/user-disabled': 'The user account has been disabled.',
  'auth/user-not-found': 'There is no user corresponding to the given email.',
  'auth/wrong-password': 'The password is invalid or the user does not have a password.',
  'auth/invalid-credential': 'The credential used to sign in is invalid.',
};

export const ATTENDANCE_BONUS_LKR = 1000;

// Salary Calculation Constants
export const TARGET_SALARY_LKR = 50000;
export const WORKING_DAYS_PER_MONTH = 25;
export const AVAILABLE_MINUTES_PER_DAY = 480; // 8 hours * 60 minutes
