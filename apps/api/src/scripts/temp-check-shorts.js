const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'apps/api/.dev.vars' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data } = await supabase.from('youtube_videos').select('youtube_video_id').limit(50);
  const ids = data.map(d => d.youtube_video_id).join(',');
  const url = `https://youtube.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${process.env.YOUTUBE_API_KEY}`;
  
  const res = await fetch(url);
  const json = await res.json();
  
  let shortCount = 0;
  let longCount = 0;
  
  json.items.forEach(item => {
    const durationStr = item.contentDetails.duration;
    // Shorts are 60 seconds or less. E.g., PT59S, PT1M. 
    // If it has H (hours), it's long. If it has M and the number is > 1, it's long.
    let isShort = false;
    if (!durationStr.includes('H') && !durationStr.includes('M')) {
      isShort = true; // Only seconds, e.g. PT45S
    } else if (durationStr === 'PT1M' || durationStr === 'PT1M0S') {
      isShort = true; // Exactly 60s
    }
    
    if (isShort) shortCount++;
    else longCount++;
  });
  
  console.log('Tested 50 videos.');
  console.log('Shorts (<= 60s):', shortCount);
  console.log('Long form:', longCount);
}
test();
