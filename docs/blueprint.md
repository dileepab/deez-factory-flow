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

## UI/UX Enhancements:

- **Search and Filtering**: A search bar has been added to the Garment Style Management card, allowing for quick filtering of styles by name.
- **Inline Operation Viewing**: An accordion view has been implemented, allowing users to see the operations for each style directly on the main management page without navigating to a separate detail page.
- **Visual Polish**: The UI has been refined for better visual consistency. For example, the "Re-seed Data" button now uses the destructive variant to clearly indicate a dangerous action.

## Advanced Features (Future Implementation):

- **Operator Skill Level Calculation**:
    - Track operator performance (efficiency and rework rate) for each specific operation and machine type.
    - Develop a "skill level" metric (e.g., a score from 1-5 or a percentage) for each operator-operation-machine combination.
    - This data will be crucial for optimizing production line balancing.
- **AI-Powered Daily Production Planning**:
    - Create a system that takes daily operator attendance as input.
    - Utilize operator skill level data to generate an optimal daily production plan.
    - The plan will assign specific operations to the most suitable operators to maximize output and quality.
    - It will define the sequence and quantity of garments for each operator, effectively balancing the production line.

## Style Guidelines:

- Primary color: Deep Indigo (#3F51B5) to evoke a sense of reliability and industrial process.
- Background color: Light Grey (#F0F2F5), offering a clean and unobtrusive backdrop.
- Accent color: Violet (#9C27B0), used sparingly to highlight key actions and data points.
- Body and headline font: 'Inter' (sans-serif) for a modern and easily readable interface.
- Use simple, consistent icons from a library like Material Icons to represent different operations and data points.
- Responsive layout that adapts to different screen sizes, especially mobile devices for supervisor data entry.
- Subtle transitions and animations to provide feedback and improve the user experience.
