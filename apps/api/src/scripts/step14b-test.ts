import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import { getRecommendations } from '../services/recommendation-engine.js';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const requirements = { category: 'dishwasher' };
  const res = await getRecommendations(supabase, requirements);
  console.log("Returned candidates:", res.length);
  if (res.length > 0) {
    console.log(JSON.stringify(res[0], null, 2));
  }
}
run();
