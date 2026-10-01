import { SupabaseClient } from '@supabase/supabase-js';

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Resolves the VM One channel ID and Uploads Playlist ID.
 */
async function getVMOneUploadsPlaylistId(apiKey: string): Promise<string> {
  const url = `https://youtube.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=VMone&key=${apiKey}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`YouTube API error during channel resolution: ${response.statusText}`);
  }

  const data: any = await response.json();
  if (!data.items || data.items.length === 0) {
    throw new Error('VM One channel not found using handle @VMone');
  }

  const uploadsPlaylistId = data.items[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error('Uploads playlist not found for the channel');
  }

  return uploadsPlaylistId;
}

/**
 * Fetches video metadata from a playlist and returns them formatted for the database.
 */
async function fetchPlaylistVideos(
  apiKey: string,
  playlistId: string,
  startDate: Date,
  endDate: Date
) {
  const videos = [];
  let nextPageToken = '';
  let keepFetching = true;
  let skipped = 0;

  while (keepFetching) {
    const url = `https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      // Handle quota errors specifically if needed
      if (response.status === 403) {
        throw new Error('YouTube API Quota exceeded or forbidden');
      }
      throw new Error(`YouTube API error during playlist fetch: ${response.statusText}`);
    }

    const data: any = await response.json();
    if (!data.items || data.items.length === 0) break;

    for (const item of data.items) {
      const publishedAt = new Date(item.snippet.publishedAt);
      
      // PlaylistItems are ordered newest first.
      // If we hit a video older than our start date, we can stop fetching entirely.
      if (publishedAt < startDate) {
        keepFetching = false;
        break;
      }

      // If the video is newer than our end date, skip it but keep fetching
      // to get to the videos within the window.
      if (publishedAt > endDate) {
        skipped++;
        continue;
      }

      const thumbnail = item.snippet.thumbnails?.maxres?.url || 
                        item.snippet.thumbnails?.high?.url || 
                        item.snippet.thumbnails?.default?.url || 
                        null;

      const videoId = item.snippet.resourceId.videoId;

      videos.push({
        youtube_video_id: videoId,
        title: item.snippet.title,
        description: item.snippet.description, // Storing full description
        thumbnail_url: thumbnail,
        published_at: item.snippet.publishedAt, // Raw UTC ISO string
        youtube_url: `https://www.youtube.com/watch?v=${videoId}`
      });
    }

    nextPageToken = data.nextPageToken;
    if (!nextPageToken) {
      keepFetching = false;
    }
  }

  return { videos, skipped };
}

/**
 * Upserts video records into Supabase and returns stats.
 */
async function syncVideosToSupabase(supabase: SupabaseClient, videos: any[]) {
  if (videos.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  // 1. Fetch existing IDs to accurately count inserts vs updates
  const videoIds = videos.map(v => v.youtube_video_id);
  const { data: existing, error: fetchError } = await supabase
    .from('youtube_videos')
    .select('youtube_video_id')
    .in('youtube_video_id', videoIds);

  if (fetchError) {
    throw new Error(`Supabase fetch error: ${fetchError.message}`);
  }

  const existingIds = new Set((existing || []).map((e: any) => e.youtube_video_id));
  let inserted = 0;
  let updated = 0;

  for (const v of videos) {
    if (existingIds.has(v.youtube_video_id)) updated++;
    else inserted++;
  }

  // 2. Perform the Upsert
  const { error: upsertError } = await supabase
    .from('youtube_videos')
    .upsert(videos, { onConflict: 'youtube_video_id' });

  if (upsertError) {
    throw new Error(`Supabase upsert error: ${upsertError.message}`);
  }

  return { inserted, updated };
}

/**
 * Main service function to coordinate YouTube synchronization.
 */
export async function syncYouTubeVideos(
  apiKey: string,
  supabase: SupabaseClient,
  start: string = '2024-10-01',
  end?: string
): Promise<SyncResult> {
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY is missing');
  }

  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date(); // default to now

  // 1. Resolve VM One uploads playlist
  const uploadsPlaylistId = await getVMOneUploadsPlaylistId(apiKey);

  // 2. Fetch videos in the date window
  const { videos, skipped } = await fetchPlaylistVideos(apiKey, uploadsPlaylistId, startDate, endDate);

  // 3. Upsert to Supabase
  const { inserted, updated } = await syncVideosToSupabase(supabase, videos);

  return {
    fetched: videos.length,
    inserted,
    updated,
    skipped
  };
}
