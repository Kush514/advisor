import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.dev.vars') });

import { syncYouTubeVideos } from '../src/services/youtube.js';
import { processAllVideoDescriptions } from '../src/services/youtube-description-parser.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const apiKey = process.env.YOUTUBE_API_KEY!;
const startDate = process.env.YOUTUBE_SYNC_START_DATE || '2024-10-01';

async function run() {
  console.log(`\n📺 Fetching latest YouTube videos since ${startDate}...`);
  try {
    const videoStats = await syncYouTubeVideos(apiKey, supabase, startDate);
    console.log(`✅ Fetched ${videoStats.fetched} videos. Inserted ${videoStats.inserted}, Updated ${videoStats.updated}, Skipped ${videoStats.skipped}.`);
    
    console.log(`\n🔍 Parsing video descriptions for new Amazon products...`);
    const parseStats = await processAllVideoDescriptions(supabase);
    console.log(`✅ Extracted ${parseStats.totalExtractedUrls} URLs from descriptions.`);
    console.log(`✅ Created ${parseStats.newProductsCreated} brand new products!`);
    console.log(`✅ Linked ${parseStats.linksCreated} product links!`);

  } catch (err: any) {
    console.error('Failed to sync YouTube:', err.message);
    process.exit(1);
  }
}

run();
