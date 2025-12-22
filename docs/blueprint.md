# **App Name**: FactoryFlow

## Core Features:

- User Authentication: Secure login for admins, supervisors, and operators with role-based access control.
- Style Management: Admin can add and manage garment styles, including operations and SMV.
- Production Entry: Supervisors input hourly production data, including cumulative quantity and rework quantity, optimized for mobile devices.
- Earnings Calculation: Automatically calculates daily earnings based on SMV, total earned minutes, available minutes, target salary (50,000 LKR), and attendance bonus.
- Efficiency Tracking: Calculates and displays operator efficiency (Earned Minutes / Worked Minutes) * 100.
- Salary Slip Generation: Generates a salary slip displaying base pay, piece rate earnings, and attendance bonus.
- Live Leaderboard: Displays a real-time leaderboard of top 5 operators by efficiency percentage. Refreshes automatically via Firestore snapshot listeners.
- AI-Powered Suggestions: Provides supervisors and admins with AI-driven suggestions for improving efficiency and production flow, based on real-time data analysis. The AI tool will decide when it is appropriate to incorporate internal data in the suggestion.

## Style Guidelines:

- Primary color: Deep Indigo (#3F51B5) to evoke a sense of reliability and industrial process.
- Background color: Light Grey (#F0F2F5), offering a clean and unobtrusive backdrop.
- Accent color: Violet (#9C27B0), used sparingly to highlight key actions and data points.
- Body and headline font: 'Inter' (sans-serif) for a modern and easily readable interface.
- Use simple, consistent icons from a library like Material Icons to represent different operations and data points.
- Responsive layout that adapts to different screen sizes, especially mobile devices for supervisor data entry.
- Subtle transitions and animations to provide feedback and improve the user experience.