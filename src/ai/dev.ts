import { config } from 'dotenv';
config({ path: ['.env.local', '.env.development', '.env'] });

import '@/ai/flows/efficiency-improvement-suggestions.ts';
import '@/ai/flows/line-balancer.ts';
