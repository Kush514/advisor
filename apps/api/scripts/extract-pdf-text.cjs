// Extracts text + embedded link URLs from VM One PDFs that have not been read yet
// (pdf_documents.extracted_text IS NULL). Same extraction as re-extract-pdfs.js, but only for new PDFs.
// Usage (from repo root): node apps/api/scripts/extract-pdf-text.cjs
const { createClient } = require('@supabase/supabase-js');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
require('dotenv').config({ path: 'apps/api/.dev.vars' });

async function run() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: pdfs, error } = await supabase.from('pdf_documents').select('id, resolved_url').is('extracted_text', null);
  if (error) throw error;
  console.log(`${pdfs.length} PDF(s) waiting for text extraction.`);

  for (const doc of pdfs) {
    console.log(`Extracting: ${doc.resolved_url}`);
    try {
      const response = await fetch(doc.resolved_url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const pdf = await pdfjs.getDocument({ data: await response.arrayBuffer() }).promise;

      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const annotations = await page.getAnnotations();

        // Link annotations are matched to the text line at (roughly) the same vertical position
        const linksByY = annotations.filter(a => a.url && a.rect).map(a => ({ url: a.url, y: a.rect[1] }));
        const linksFor = y => linksByY.filter(l => Math.abs(l.y - y) < 10).map(l => l.url).join(' ');

        let pageText = '';
        let currentY = null;
        let lineText = '';
        for (const item of textContent.items) {
          const itemY = Math.round(item.transform[5]);
          if (currentY !== itemY) {
            const links = linksFor(currentY);
            pageText += lineText + (links ? ' ' + links : '') + '\n';
            lineText = '';
            currentY = itemY;
          }
          lineText += item.str;
        }
        const links = linksFor(currentY);
        fullText += pageText + lineText + (links ? ' ' + links : '') + '\n\n\n';
      }

      const { error: updateError } = await supabase
        .from('pdf_documents')
        .update({ extracted_text: fullText, page_count: pdf.numPages })
        .eq('id', doc.id);
      if (updateError) throw updateError;
      console.log(` -> ${pdf.numPages} pages, ${fullText.length} characters, ${(fullText.match(/https?:\/\//g) || []).length} links`);
    } catch (e) {
      console.error(` -> failed: ${e.message}`);
    }
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
