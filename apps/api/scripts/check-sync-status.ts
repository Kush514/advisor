import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.dev.vars') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // We consider a product "synced" if it was updated in the last 24 hours
  const yesterday = new Date();
  yesterday.setHours(yesterday.getHours() - 24);
  const isoDate = yesterday.toISOString();

  // Get total active products
  const { count: totalProducts, error: totalErr } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  // Get synced products
  const { count: syncedProducts, error: syncedErr } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .gte('updated_at', isoDate);

  if (totalErr || syncedErr) {
    console.error("Error fetching status:", totalErr || syncedErr);
    return;
  }

  const percentage = Math.round((syncedProducts! / totalProducts!) * 100);

  console.log(`\n📊 SYNC PROGRESS 📊`);
  console.log(`------------------------`);
  console.log(`✅ Synced Products: ${syncedProducts}`);
  console.log(`📦 Total Products:  ${totalProducts}`);
  console.log(`📈 Progress:        ${percentage}%\n`);
  
  if (syncedProducts === totalProducts) {
    console.log('🎉 SYNC IS 100% COMPLETE! You can now run the generate-questions.ts script!');
  } else {
    const remaining = totalProducts! - syncedProducts!;
    // 12.5 seconds per remaining product
    const secondsLeft = remaining * 12.5;
    const hours = Math.floor(secondsLeft / 3600);
    const minutes = Math.floor((secondsLeft % 3600) / 60);
    console.log(`⏳ Estimated time remaining: ${hours} hours and ${minutes} minutes`);
  }
}

main();
