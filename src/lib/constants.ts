export const MACHINE_TYPES = [
  'Single Needle Lockstitch',
  'Double Needle Lockstitch',
  'Overlock/Serger',
  'Flatlock/Coverstitch',
  'Buttonhole Machine',
  'Button Attach Machine',
  'Waist Band (Kansai)',
  'Piping Attach with Single Needle',
] as const;

export const FIREBASE_AUTH_ERRORS: { [key: string]: string } = {
  'auth/email-already-in-use': 'A user with this email already exists.',
  'auth/invalid-email': 'The email address is not valid.',
  'auth/operation-not-allowed': 'This operation is not allowed.',
  'auth/weak-password': 'The password is not strong enough.',
  'auth/user-disabled': 'This user has been disabled.',
  'auth/user-not-found': 'No user found with this email.',
  'auth/wrong-password': 'The password you entered is incorrect.',
};
