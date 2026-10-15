import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import { getRecommendations } from '../services/recommendation-engine.js';

dotenv.config({ path: 'apps/api/.dev.vars' });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  console.log("Running audit script...");
  
  const report: any = {
    Issues: []
  };

  // Check Invariant 3: VM ONE Evidence
  const fileContent = fs.readFileSync('apps/api/src/services/recommendation-engine.ts', 'utf8');
  if (fileContent.includes("eq('reviewed_by_vmone', true)")) {
    report.Issues.push({
      Issue: "VM ONE evidence is hard-coded as an eligibility requirement",
      File: "apps/api/src/services/recommendation-engine.ts",
      Function: "getRecommendations",
      CurrentBehavior: "Filters by eq('reviewed_by_vmone', true), which drops all products without an exact product review (violates Step 12C).",
      ExpectedBehavior: "Remove eq('reviewed_by_vmone', true). Eligibility is fully captured by recommendable = true.",
      Severity: "CRITICAL",
      RecommendedFix: "Change query.eq('reviewed_by_vmone', true).eq('recommendable', true) to query.eq('recommendable', true)"
    });
  }

  // Check Invariant 7: Tie-breaking
  if (!fileContent.includes("localeCompare") && !fileContent.includes("a.product.id") && !fileContent.includes("a.productId")) {
    report.Issues.push({
      Issue: "No deterministic tie-breaker in ranking",
      File: "apps/api/src/services/recommendation-engine.ts",
      Function: "getRecommendations",
      CurrentBehavior: "results.sort((a, b) => b.matchScore - a.matchScore) lacks a secondary tie-breaker, falling back to non-deterministic Postgres array order.",
      ExpectedBehavior: "If matchScore is equal, break ties using a stable field like productId or product name.",
      Severity: "HIGH",
      RecommendedFix: "Add a secondary tie-breaker: `if (a.matchScore === b.matchScore) return a.productId.localeCompare(b.productId);`"
    });
  }
  
  // Test Case: Washing Machine
  const wmReqs = { category: 'washing-machine', budget: { kind: 'group' as const, value: 'UNDER_30K' } };
  const wmResults = await getRecommendations(supabase, wmReqs);
  
  // Test Case: Dishwasher
  const dwReqs = { category: 'dishwasher' };
  const dwResults = await getRecommendations(supabase, dwReqs);

  fs.writeFileSync('step13a-audit-results.json', JSON.stringify({ wmResults: wmResults.length, dwResults: dwResults.length, issues: report.Issues }, null, 2));
  console.log("Audit complete.");
}

run();
