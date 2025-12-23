import { MACHINE_TYPES } from './constants';

export type Operation = {
  id: string;
  name: string;
  time: number; // in seconds
  machineType: typeof MACHINE_TYPES[number];
  dependencies: string[];
};

export type GarmentStyle = {
  id: string;
  name: string;
  operations: Operation[];
  totalSmv: number; // in minutes
};
