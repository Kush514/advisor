import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Unattended sync, meant to run on a schedule (see .github/workflows/auto-sync.yml).
//
//   1. Looks at the VM One channel's newest uploads. No new video -> nothing to do.
//   2. New video -> reads the product links in its description (PDF links are ignored), creates any
//      products we don't have yet, cleans their names/specs/category, attaches the video, and gives
//      new products VM One's original Amazon link (vmone-21 only when there is no working original).
//   3. Refreshes Amazon prices + stock and shows only buyable products, then rebuilds the budget
//      ranges. This also runs without a new video when --refresh is passed (once a day).
//
// Questions: budget ranges are rebuilt in step 3; size/type and preference questions are built live
// from the products (finder-questions.ts), so new sizes or features appear without regenerating anything.
//
// Usage (from apps/api): npx tsx scripts/auto-sync.ts [--refresh] [--force]
//   --refresh  also refresh prices/stock when there is no new video
//   --force    run the full pipeline even when there is no new video

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.resolve(API_DIR, '.dev.vars') }); // local runs; in CI the variables come from secrets

const REFRESH = process.argv.includes('--refresh');
const FORCE = process.argv.includes('--force');

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

function run(script: string, description: string) {
  console.log(`\n────────── ${description} ──────────`);
  // Child scripts inherit this process's environment, so they work with or without a .dev.vars file
  execSync(`npx --yes tsx scripts/${script}`, { stdio: 'inherit', cwd: API_DIR, env: process.env });
}

/** YouTube video IDs among the channel's 50 newest uploads that are not in the database yet. */
async function findNewVideos(): Promise<{ id: string; title: string }[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is missing');

  const channel: any = await (await fetch(`https://youtube.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=VMone&key=${key}`)).json();
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`Could not read the VM One channel: ${JSON.stringify(channel.error || channel).slice(0, 200)}`);

  const page: any = await (await fetch(`https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploads}&maxResults=50&key=${key}`)).json();
  if (page.error) throw new Error(`YouTube API: ${page.error.message}`);

  const latest = (page.items || []).map((it: any) => ({ id: it.snippet.resourceId.videoId as string, title: it.snippet.title as string }));
  const { data: known, error } = await supabase.from('youtube_videos').select('youtube_video_id').in('youtube_video_id', latest.map((v: any) => v.id));
  if (error) throw new Error(`Supabase: ${error.message}`);

  const knownIds = new Set((known || []).map(k => k.youtube_video_id));
  return latest.filter((v: any) => !knownIds.has(v.id));
}

async function main() {
  const newVideos = await findNewVideos();
  console.log(`New VM One videos: ${newVideos.length}`);
  newVideos.forEach(v => console.log(`  • ${v.title}`));

  const fullRun = newVideos.length > 0 || FORCE;
  if (!fullRun && !REFRESH) {
    console.log('Nothing to do.');
    return;
  }

  if (fullRun) {
    run('sync-raw-data.ts --no-pdf', 'Videos → description links → Amazon products → new products');
    run('link-evidence.ts', 'Attach videos to the products they mention');
    run('sync-amazon.ts', 'Clean names, specs and category for new products');
    // VM One's own working link (with its tracking ID) is used as-is; only products without one get
    // amazon.in/dp/ASIN?tag=vmone-21. Only new products are checked, existing originals are left alone.
    run('apply-original-links.ts --apply --only-new', 'Amazon links (VM One original, else vmone-21)');
  }

  run('refresh-availability.ts --apply', 'Prices, stock, and which products are shown');
  run('rebuild-price-brackets.ts --apply', 'Budget ranges');
  // Review list of products Amazon's API won't return (uploaded as a download by the GitHub workflow)
  run('export-api-blocked.ts', 'Review list: products Amazon does not share');

  console.log(`\nDone. ${fullRun ? `Processed ${newVideos.length} new video(s).` : 'Prices and stock refreshed.'}`);
}

main().catch(err => {
  console.error('\nAuto-sync failed:', err.message);
  process.exit(1);
});
