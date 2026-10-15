import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runScript(scriptName: string, description: string) {
  console.log(`\n======================================================`);
  console.log(`▶️ STARTING: ${description}`);
  console.log(`======================================================`);
  
  try {
    const scriptPath = path.resolve(__dirname, scriptName);
    // Inherit stdio so the colors and logs show up perfectly in the terminal
    execSync(`npx tsx --env-file=.dev.vars ${scriptPath}`, { 
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..') // Run from apps/api
    });
    console.log(`✅ FINISHED: ${description}\n`);
  } catch (error) {
    console.error(`\n❌ ERROR RUNNING SCRIPT: ${scriptName}`);
    console.error(`Please fix the error above before continuing.`);
    process.exit(1);
  }
}

console.log(`\n🚀 STARTING FULL MASTER SYNC 🚀`);
console.log(`This will process new products, categorize them, update prices, fix links, and regenerate questions.\n`);

// 1. Sync Raw Data (YouTube videos -> Video Links -> PDFs -> PDF Links -> ASINs -> Final Products)
runScript('sync-raw-data.ts', 'Step 1/6: Raw Data Extraction (YouTube & PDFs)');

// 2. Sync Amazon Specs (Cleans messy data via Gemini)
runScript('sync-amazon.ts', 'Step 2/6: Cleaning Product Specs (Universal Lookup)');

// 3. Categorize (Places new products into the right categories)
runScript('categorize.ts', 'Step 3/6: Smart AI Categorization');

// 4. Update Prices (Fast sync for all 900+ products via Creator API)
runScript('update-prices.ts', 'Step 4/6: Updating Live Amazon Prices');

// 5. Affiliate Links (Injects vmone-21 tag for any new products)
runScript('generate-affiliate-links.ts', 'Step 5/6: Injecting Affiliate Links');

// 6. Generate Questions (Rebuilds smart quiz questions if new specs appeared)
runScript('generate-questions.ts', 'Step 6/6: Rebuilding Smart Quiz Questions');

console.log(`\n🎉 MASTER SYNC COMPLETE! 🎉`);
console.log(`Your database is fully updated, monetized, and ready to recommend!`);
