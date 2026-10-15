# Recommendation Data Contract

## 1. Category Matching Semantics
- **Questionnaire Output**: Uses the stable `slug` field (e.g., `tv`, `washing-machine`).
- **Engine Expects**: `ProductRequirements.category`
- **Mapping**: Matched against `products.category_id` (via relational slug/name) or `products.subcategory`.
- **Semantics**: Exact string match. Case-insensitive.

## 2. Budget Contract & Matching Semantics
- **Questionnaire Output**: Stable string constants representing discrete budget ranges (e.g., `UNDER_30K`, `30K_50K`).
- **Product Attribute**: Found in `product_specs` under `spec_key = 'budget_group'`.
- **Engine Mapping**: 
  - The `ProductRequirements.budget` supports both range (`{ min, max }`) and group (`{ value: string }`).
  - Currently mapped as **Group Match** (string-based) to bypass the lack of scraped numeric prices.
- **Semantics**:
  - Both sides are normalized before comparison (lowercased, underscores replaced with spaces, trimmed).
  - **MATCH (+15 score)**: If normalized strings match exactly.
  - **MISMATCH (-10 score)**: If product has a budget group and it differs.
  - **UNKNOWN (0 score)**: If product has no budget group data.

## 3. Brand & Model Matching Semantics
- **Brand**: Maps directly to `products.brand`. Case-insensitive match against an array of accepted brands.
- **Model**: Maps directly to `products.model`. Substring inclusion match against the model string.

## 4. Feature & Spec Matching Semantics (Non-Budget Questions)
The questionnaire defines 4 questions per category (Total 88 questions).
These are resolved against `product_specs` and soft-matched against descriptions:

| Question Key | Product Attribute | Matching Type | Notes |
|---|---|---|---|
| `screen_size` | `product_specs.screen_size` | DIRECT_MATCH | E.g., TV size in inches |
| `capacity` | `product_specs.capacity` | DIRECT_MATCH | Used for AC, WM, Fridges |
| `load_type` | `product_specs.load_type` | DIRECT_MATCH | Front/Top load |
| `room_size` | `product_specs.room_size` | DIRECT_MATCH | ACs, Fans, Purifiers |
| `family_size` | `product_specs.capacity` | DERIVED_MATCH | Mapped internally to capacity logic |
| `installation` | `product_specs.installation` | DIRECT_MATCH | |
| `access_method` | `product_specs.access_method` | DIRECT_MATCH | Smart Locks |
| `battery_backup`| `product_specs.battery_backup`| DIRECT_MATCH | Inverters |
| `priority` | `N/A` | UNSUPPORTED | A ranking preference, not a physical attribute. Influences internal weight, but not a database spec. |
| `usage` | `product_specs.usage` / Description | SOFT_MATCH | Often ambiguous; matched as a general keyword feature in `recommendation-engine.ts`. |
| `concern` | `product_specs.features` / Desc | SOFT_MATCH | Matched via keyword search. |
| `cooking_type` | `product_specs.cooking_type` | SOFT_MATCH | Mapped via keyword features. |

## 5. UNKNOWN Behavior
- The recommendation engine penalizes (-5) only if *absolutely no* criteria match and there are known mismatches.
- A criteria marked as UNKNOWN (e.g., missing budget) does not positively increase the score, ensuring we don't hallucinate compatibility.

## 6. Eligibility vs Recommendation
- **Eligibility** (`recommendable = true`) answers: *"Is this product allowed to be seen?"*
- **Recommendation Scoring** answers: *"How well does this product fit?"*
- We enforce a hard separation: `getRecommendations` actively filters by `recommendable = true` before calculating any scores.
