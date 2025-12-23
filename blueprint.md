# Project Blueprint

This document outlines the data models, UI components, and overall architecture of the production planning application.

## Data Models

The core of the application revolves around three main data models: `GarmentStyle`, `Operation`, and `Operator`.

### GarmentStyle

Represents a specific garment being manufactured. Each style has a unique set of operations required for its completion.

- `id` (string): A unique identifier for the style (e.g., 'style-1').
- `name` (string): The display name of the style (e.g., 'Classic Crew Neck T-Shirt').
- `startDate` (string): The date when the style is scheduled to begin production (format: YYYY-MM-DD).
- `operations` (array of `Operation` objects): A list of all the manufacturing steps required to produce the garment.
- `totalSmv` (number): The total Standard Minute Value for the style, calculated by summing the time of all its operations and converting to minutes.

### Operation

Represents a single manufacturing step within a `GarmentStyle`.

- `id` (string): A unique identifier for the operation (e.g., 'op-1-1').
- `name` (string): The name of the operation (e.g., 'Cut Fabric').
- `time` (number): The time required to complete the operation, in seconds.
- `machineType` (string): The type of machine required for the operation (e.g., 'Single Needle Lockstitch').
- `dependencies` (array of strings): A list of `operation.id`s that must be completed before this operation can begin.

### Operator

Represents a factory worker who performs the manufacturing operations.

- `id` (string): A unique identifier for the operator (e.g., 'op-1').
- `name` (string): The full name of the operator.
- `efficiency` (number): The operator's overall efficiency rating, as a percentage.
- `reworkRate` (number): The operator's rework rate, as a percentage.
- `attendance` (number): The operator's attendance record, as a percentage.
- `assignedStyle` (string): The name of the `GarmentStyle` the operator is currently assigned to.
- `dailyProductions` (array of objects): A record of the operator's daily output, with each object containing:
    - `date` (string): The date of production.
    - `quantity` (number): The number of units produced.

## UI Components

The application is built with a modular, component-based architecture using React and Next.js.

### Style Management (`style-management.tsx`)

- Displays a table of all garment styles.
- Allows users to add, view, and manage styles.
- Includes a feature to seed the database with initial `GarmentStyle` data.
- Provides a dialog for adding new styles, including a start date.

## Key Features

- **Production Planning:** The system is designed to support AI-powered production planning, which will use the detailed data models to optimize operator assignments and production schedules.
- **Performance Tracking:** The app tracks operator performance metrics, including efficiency, rework rate, and attendance, to provide insights into factory floor productivity.

This blueprint will be updated as the project evolves.
