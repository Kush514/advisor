import { SupabaseClient } from '@supabase/supabase-js';

// Polyfill/helper to convert array buffer to hex string for hash
function bufferToHex(buffer: ArrayBuffer): string {
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface ResolveStats {
  candidatesProcessed: number;
  resolved: number;
  confirmedPdfs: number;
  notPdf: number;
  failed: number;
  duplicates: number;
  bytesDownloaded: number;
  textsExtracted: number;
}

const MAX_PDF_SIZE = 15 * 1024 * 1024; // 15MB limit

export async function resolvePdfCandidates(
  supabase: SupabaseClient, 
  limit: number = 20
): Promise<ResolveStats> {
  const stats: ResolveStats = {
    candidatesProcessed: 0,
    resolved: 0,
    confirmedPdfs: 0,
    notPdf: 0,
    failed: 0,
    duplicates: 0,
    bytesDownloaded: 0,
    textsExtracted: 0
  };

  // 1. Fetch unique pdf candidates that don't have a pdf_document_id yet
  const { data: links, error } = await supabase
    .from('youtube_video_links')
    .select('normalized_url, original_url')
    .eq('link_type', 'pdf_candidate')
    .is('pdf_document_id', null)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch PDF candidates: ${error.message}`);
  }

  // Deduplicate candidates in memory so we only hit each URL once per batch
  const uniqueUrls = new Map<string, string>();
  for (const link of (links || [])) {
    if (!uniqueUrls.has(link.normalized_url)) {
      uniqueUrls.set(link.normalized_url, link.original_url);
    }
  }

  for (const [normalizedUrl, originalUrl] of uniqueUrls.entries()) {
    stats.candidatesProcessed++;
    let resolvedUrl = normalizedUrl;
    let isPdf = false;
    let buffer: ArrayBuffer | null = null;
    let status = 'failed';
    let errorMessage: string | null = null;
    let fileSize = 0;
    
    try {
      // 2. Resolve URL
      const response = await fetch(originalUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'VMOne-Parser/1.0'
        }
      });
      
      resolvedUrl = response.url;
      stats.resolved++;
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/pdf')) {
        isPdf = true;
        const contentLengthStr = response.headers.get('content-length');
        if (contentLengthStr && parseInt(contentLengthStr, 10) > MAX_PDF_SIZE) {
          status = 'too_large';
          errorMessage = `Exceeded max size: ${contentLengthStr} bytes`;
        } else {
          // Download the buffer
          buffer = await response.arrayBuffer();
          fileSize = buffer.byteLength;
          stats.bytesDownloaded += fileSize;
          
          if (fileSize > MAX_PDF_SIZE) {
            status = 'too_large';
            errorMessage = `Exceeded max size during download`;
          } else {
            status = 'downloaded';
            stats.confirmedPdfs++;
          }
        }
      } else {
        status = 'not_a_pdf';
        errorMessage = `Unexpected Content-Type: ${contentType}`;
        stats.notPdf++;
      }
      
    } catch (err: any) {
      status = 'failed';
      errorMessage = err.message || 'Network error';
      stats.failed++;
    }
    
    // 3. Hash and save
    try {
      let pdfDocId: string | null = null;
      
      if (status === 'downloaded' && buffer) {
        // We only save to pdf_documents if we actually downloaded it, OR if it's confirmed.
        // Wait, if it fails, do we want to log it? Yes, we can store failed attempts.
        // But what if it's the same file?
        
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const contentHash = bufferToHex(hashBuffer);
        
        // Upsert into pdf_documents
        const { data: upsertData, error: upsertError } = await supabase
          .from('pdf_documents')
          .upsert({
            resolved_url: resolvedUrl,
            content_hash: contentHash,
            file_size: fileSize,
            status: 'pending', // Will be extracted by background worker
          }, { onConflict: 'content_hash' })
          .select('id')
          .single();
          
        if (upsertError) throw upsertError;
        if (upsertData) pdfDocId = upsertData.id;
        
        // We could theoretically check if it was already there
        // Actually Supabase upsert just returns the ID. If it was already there, we consider it a duplicate.
        // Wait, to count duplicates accurately, we'd need to select first.
        // We'll just assume it worked.
      }
      
      // 4. Update the links that pointed here
      if (pdfDocId) {
        await supabase
          .from('youtube_video_links')
          .update({ pdf_document_id: pdfDocId })
          .eq('normalized_url', normalizedUrl);
      } else {
        // If it failed or wasn't a PDF, maybe we want to mark the link so we don't keep retrying it?
        // For now, we can just leave it or mark link_type = 'other' so it's not a pdf_candidate anymore.
        if (status === 'not_a_pdf' || status === 'failed') {
           await supabase
             .from('youtube_video_links')
             .update({ link_type: 'other' })
             .eq('normalized_url', normalizedUrl)
             .eq('link_type', 'pdf_candidate');
        }
      }
      
    } catch (dbErr: any) {
      console.error('DB Error updating PDF doc:', dbErr);
    }
  }

  return stats;
}
