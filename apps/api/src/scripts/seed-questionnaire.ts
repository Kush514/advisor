import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Note: Ensure you run this from the project root using ts-node or similar so paths align
dotenv.config({ path: 'apps/api/.dev.vars' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function toOptions(arr: string[]) {
  return arr.map(opt => ({
    label: opt,
    value: opt.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').replace(/_$/, '')
  }));
}

const CATEGORIES = [
  {
    name: 'TV', slug: 'tv',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 30K', '30K-50K', '50K-80K', 'ABOVE 80K']) },
      { key: 'screen_size', text: "What screen size are you looking for?", type: 'single_select', options: toOptions(['32', '43', '50', '55', '65', '75+']) },
      { key: 'usage', text: "What will you mainly use the TV for?", type: 'single_select', options: toOptions(['MOVIES', 'SPORTS', 'GAMING', 'OTT', 'MIXED']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['PICTURE QUALITY', 'SOUND', 'GAMING', 'SMART FEATURES', 'VALUE']) }
    ]
  },
  {
    name: 'Washing Machine', slug: 'washing-machine',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 25K', '25K-40K', '40K-60K', 'ABOVE 60K']) },
      { key: 'capacity', text: "What capacity are you looking for?", type: 'single_select', options: toOptions(['6 KG', '7 KG', '8 KG', '9 KG+']) },
      { key: 'load_type', text: "Which load type do you prefer?", type: 'single_select', options: toOptions(['FRONT LOAD', 'TOP LOAD', 'SEMI AUTOMATIC']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['WASH QUALITY', 'WATER SAVING', 'ENERGY SAVING', 'CONVENIENCE', 'VALUE']) }
    ]
  },
  {
    name: 'Air Conditioner', slug: 'air-conditioner',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 35K', '35K-50K', '50K-70K', 'ABOVE 70K']) },
      { key: 'capacity', text: "What capacity do you need?", type: 'single_select', options: toOptions(['1 TON', '1.5 TON', '2 TON', '2.5 TON+']) },
      { key: 'room_size', text: "What is your room size?", type: 'single_select', options: toOptions(['SMALL', 'MEDIUM', 'LARGE', 'VERY LARGE']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['COOLING', 'ENERGY SAVING', 'LOW NOISE', 'SMART FEATURES', 'VALUE']) }
    ]
  },
  {
    name: 'Air Purifier', slug: 'air-purifier',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 10K', '10K-20K', '20K-40K', 'ABOVE 40K']) },
      { key: 'room_size', text: "What is your room size?", type: 'single_select', options: toOptions(['SMALL', 'MEDIUM', 'LARGE', 'VERY LARGE']) },
      { key: 'concern', text: "What is your main concern?", type: 'single_select', options: toOptions(['DUST', 'ALLERGIES', 'SMOKE', 'ODOUR', 'GENERAL AIR QUALITY']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['PURIFICATION', 'LOW NOISE', 'FILTER LIFE', 'SMART FEATURES', 'VALUE']) }
    ]
  },
  {
    name: 'Air Fryer', slug: 'air-fryer',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 6K', '6K-10K', '10K-15K', 'ABOVE 15K']) },
      { key: 'capacity', text: "What capacity do you need?", type: 'single_select', options: toOptions(['UNDER 4L', '4L-6L', '6L-8L', 'ABOVE 8L']) },
      { key: 'usage', text: "What will you mainly use it for?", type: 'single_select', options: toOptions(['SNACKS', 'FAMILY MEALS', 'BAKING', 'REHEATING', 'MIXED']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['COOKING QUALITY', 'CAPACITY', 'SPEED', 'EASE OF USE', 'VALUE']) }
    ]
  },
  {
    name: 'Chimney', slug: 'chimney',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 15K', '15K-25K', '25K-40K', 'ABOVE 40K']) },
      { key: 'installation', text: "What is your installation type?", type: 'single_select', options: toOptions(['WALL MOUNTED', 'ISLAND', 'UNDER CABINET']) },
      { key: 'cooking_type', text: "What is your cooking type?", type: 'single_select', options: toOptions(['LIGHT COOKING', 'DAILY COOKING', 'HEAVY COOKING', 'FRYING']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['SUCTION', 'LOW NOISE', 'CLEANING', 'DESIGN', 'VALUE']) }
    ]
  },
  {
    name: 'Gas Stove', slug: 'gas-stove',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 5K', '5K-10K', '10K-20K', 'ABOVE 20K']) },
      { key: 'cooking_type', text: "How many burners do you need?", type: 'single_select', options: toOptions(['2 BURNER', '3 BURNER', '4 BURNER', '5+ BURNER']) },
      { key: 'family_size', text: "What is your family size?", type: 'single_select', options: toOptions(['1-2', '3-4', '5-6', '7+']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['FLAME CONTROL', 'BUILD QUALITY', 'EASY CLEANING', 'DESIGN', 'VALUE']) }
    ]
  },
  {
    name: 'Refrigerators', slug: 'refrigerators',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 25K', '25K-40K', '40K-60K', 'ABOVE 60K']) },
      { key: 'capacity', text: "What capacity do you need?", type: 'single_select', options: toOptions(['UNDER 250L', '250L-350L', '350L-500L', 'ABOVE 500L']) },
      { key: 'family_size', text: "What is your family size?", type: 'single_select', options: toOptions(['1-2', '3-4', '5-6', '7+']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['COOLING', 'ENERGY SAVING', 'STORAGE', 'FEATURES', 'VALUE']) }
    ]
  },
  {
    name: 'Electric Iron', slug: 'electric-iron',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 2K', '2K-4K', '4K-7K', 'ABOVE 7K']) },
      { key: 'usage', text: "What is your usage?", type: 'single_select', options: toOptions(['OCCASIONAL', 'REGULAR', 'HEAVY']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['FAST HEATING', 'STEAM', 'FABRIC SAFETY', 'EASY HANDLING', 'VALUE']) },
      { key: 'performance', text: "What performance level do you expect?", type: 'single_select', options: toOptions(['BASIC', 'BALANCED', 'PREMIUM']) }
    ]
  },
  {
    name: 'Vacuum Cleaners / Robot Vacuum', slug: 'vacuum-cleaners-robot-vacuum',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 10K', '10K-20K', '20K-40K', 'ABOVE 40K']) },
      { key: 'usage', text: "What will you mainly use it for?", type: 'single_select', options: toOptions(['FLOOR CLEANING', 'PET HAIR', 'DEEP CLEANING', 'FULL HOME', 'MIXED']) },
      { key: 'space', text: "What is your space size?", type: 'single_select', options: toOptions(['SMALL HOME', 'MEDIUM HOME', 'LARGE HOME', 'MULTI FLOOR']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['SUCTION', 'AUTOMATION', 'BATTERY', 'LOW NOISE', 'VALUE']) }
    ]
  },
  {
    name: 'Geyser', slug: 'geyser',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 10K', '10K-20K', '20K-30K', 'ABOVE 30K']) },
      { key: 'capacity', text: "What capacity do you need?", type: 'single_select', options: toOptions(['6L', '10L-15L', '20L-25L', '30L+']) },
      { key: 'usage', text: "What is your primary usage?", type: 'single_select', options: toOptions(['BATHROOM', 'KITCHEN', 'FAMILY', 'HEAVY USE']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['HEATING SPEED', 'ENERGY SAVING', 'SAFETY', 'DURABILITY', 'VALUE']) }
    ]
  },
  {
    name: 'Soundbars', slug: 'soundbars',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 10K', '10K-20K', '20K-40K', 'ABOVE 40K']) },
      { key: 'usage', text: "What will you mainly use it for?", type: 'single_select', options: toOptions(['MOVIES', 'MUSIC', 'GAMING', 'TV', 'MIXED']) },
      { key: 'space', text: "What is your room size?", type: 'single_select', options: toOptions(['SMALL ROOM', 'MEDIUM ROOM', 'LARGE ROOM']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['BASS', 'DIALOGUE', 'SURROUND SOUND', 'CONNECTIVITY', 'VALUE']) }
    ]
  },
  {
    name: 'Water Purifier', slug: 'water-purifier',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 10K', '10K-20K', '20K-35K', 'ABOVE 35K']) },
      { key: 'concern', text: "What is your main concern?", type: 'single_select', options: toOptions(['TDS', 'BACTERIA', 'VIRUSES', 'GENERAL PURIFICATION', 'MIXED']) },
      { key: 'family_size', text: "What is your family size?", type: 'single_select', options: toOptions(['1-2', '3-4', '5-6', '7+']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['PURIFICATION', 'WATER RECOVERY', 'MAINTENANCE', 'STORAGE', 'VALUE']) }
    ]
  },
  {
    name: 'Microwave / OTG / Oven', slug: 'microwave-otg-oven',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 10K', '10K-20K', '20K-35K', 'ABOVE 35K']) },
      { key: 'cooking_type', text: "What is your primary cooking type?", type: 'single_select', options: toOptions(['REHEATING', 'BAKING', 'GRILLING', 'FULL COOKING', 'MIXED']) },
      { key: 'capacity', text: "What capacity do you need?", type: 'single_select', options: toOptions(['UNDER 20L', '20L-30L', '30L-40L', 'ABOVE 40L']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['COOKING QUALITY', 'SPEED', 'VERSATILITY', 'EASE OF USE', 'VALUE']) }
    ]
  },
  {
    name: 'Mixer Grinder', slug: 'mixer-grinder',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 5K', '5K-10K', '10K-20K', 'ABOVE 20K']) },
      { key: 'usage', text: "What is your primary usage?", type: 'single_select', options: toOptions(['BASIC GRINDING', 'DAILY COOKING', 'HEAVY GRINDING', 'JUICING', 'MIXED']) },
      { key: 'family_size', text: "What is your family size?", type: 'single_select', options: toOptions(['1-2', '3-4', '5-6', '7+']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['MOTOR POWER', 'GRINDING QUALITY', 'NOISE', 'DURABILITY', 'VALUE']) }
    ]
  },
  {
    name: 'Ceiling Fans', slug: 'ceiling-fans',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 2K', '2K-4K', '4K-7K', 'ABOVE 7K']) },
      { key: 'room_size', text: "What is your room size?", type: 'single_select', options: toOptions(['SMALL', 'MEDIUM', 'LARGE', 'VERY LARGE']) },
      { key: 'usage', text: "What is your primary usage?", type: 'single_select', options: toOptions(['BASIC COOLING', 'DAILY USE', 'PREMIUM HOME', 'LOW POWER USE']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['AIRFLOW', 'ENERGY SAVING', 'LOW NOISE', 'DESIGN', 'VALUE']) }
    ]
  },
  {
    name: 'Electric Cooker', slug: 'electric-cooker',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 3K', '3K-6K', '6K-10K', 'ABOVE 10K']) },
      { key: 'usage', text: "What is your primary usage?", type: 'single_select', options: toOptions(['RICE', 'ONE POT MEALS', 'STEAMING', 'DAILY COOKING', 'MIXED']) },
      { key: 'family_size', text: "What is your family size?", type: 'single_select', options: toOptions(['1-2', '3-4', '5-6', '7+']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['COOKING QUALITY', 'SPEED', 'CAPACITY', 'EASE OF USE', 'VALUE']) }
    ]
  },
  {
    name: 'Inverter & Battery', slug: 'inverter-battery',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 15K', '15K-30K', '30K-50K', 'ABOVE 50K']) },
      { key: 'power_requirement', text: "What is your power requirement?", type: 'single_select', options: toOptions(['BASIC', 'MEDIUM', 'HIGH', 'VERY HIGH']) },
      { key: 'battery_backup', text: "How much battery backup do you need?", type: 'single_select', options: toOptions(['2-4 HOURS', '4-6 HOURS', '6-8 HOURS', '8+ HOURS']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['BACKUP TIME', 'LOAD CAPACITY', 'BATTERY LIFE', 'LOW NOISE', 'VALUE']) }
    ]
  },
  {
    name: 'Smart Door Lock', slug: 'smart-door-lock',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 10K', '10K-20K', '20K-35K', 'ABOVE 35K']) },
      { key: 'door_type', text: "What is your door type?", type: 'single_select', options: toOptions(['WOODEN', 'METAL', 'GLASS', 'MAIN DOOR', 'BEDROOM DOOR']) },
      { key: 'access_method', text: "Preferred access method?", type: 'single_select', options: toOptions(['FINGERPRINT', 'PIN', 'APP', 'CARD', 'MULTIPLE METHODS']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['SECURITY', 'CONVENIENCE', 'SMART FEATURES', 'DESIGN', 'VALUE']) }
    ]
  },
  {
    name: 'Air Cooler', slug: 'air-cooler',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 8K', '8K-15K', '15K-25K', 'ABOVE 25K']) },
      { key: 'room_size', text: "What is your room size?", type: 'single_select', options: toOptions(['SMALL', 'MEDIUM', 'LARGE', 'VERY LARGE']) },
      { key: 'usage', text: "Where will you primarily use it?", type: 'single_select', options: toOptions(['BEDROOM', 'LIVING ROOM', 'OFFICE', 'OUTDOOR', 'MIXED']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['COOLING', 'AIRFLOW', 'LOW NOISE', 'POWER EFFICIENCY', 'VALUE']) }
    ]
  },
  {
    name: 'Room Heaters', slug: 'room-heaters',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 3K', '3K-6K', '6K-10K', 'ABOVE 10K']) },
      { key: 'room_size', text: "What is your room size?", type: 'single_select', options: toOptions(['SMALL', 'MEDIUM', 'LARGE', 'VERY LARGE']) },
      { key: 'usage', text: "Where will you primarily use it?", type: 'single_select', options: toOptions(['BEDROOM', 'LIVING ROOM', 'OFFICE', 'BATHROOM', 'MIXED']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['HEATING', 'ENERGY SAVING', 'SAFETY', 'LOW NOISE', 'VALUE']) }
    ]
  },
  {
    name: 'Cooktop / Induction', slug: 'cooktop-induction',
    questions: [
      { key: 'budget', text: "What's your budget?", type: 'single_select', options: toOptions(['UNDER 2K', '2K-5K', '5K-10K', 'ABOVE 10K']) },
      { key: 'cooking_type', text: "What is your primary cooking type?", type: 'single_select', options: toOptions(['INDUCTION', 'GAS', 'ELECTRIC', 'MIXED']) },
      { key: 'family_size', text: "What is your family size?", type: 'single_select', options: toOptions(['1-2', '3-4', '5-6', '7+']) },
      { key: 'priority', text: "What's most important to you?", type: 'single_select', options: toOptions(['FAST HEATING', 'ENERGY SAVING', 'SAFETY', 'DESIGN', 'VALUE']) }
    ]
  }
];

async function seed() {
  console.log('--- Seeding Categories and Questions ---');

  let catsUpserted = 0;
  let qsUpserted = 0;
  let qDuplicateChecks = 0;

  for (const cat of CATEGORIES) {
    // 1. Upsert Category
    const { data: categoryData, error: catErr } = await supabase
      .from('categories')
      .upsert(
        { name: cat.name, slug: cat.slug },
        { onConflict: 'slug' }
      )
      .select('id')
      .single();

    if (catErr || !categoryData) {
      console.error(`Failed to upsert category ${cat.slug}`, catErr);
      continue;
    }
    catsUpserted++;
    const catId = categoryData.id;

    // 2. Safely Upsert Questions
    const { data: existingQs } = await supabase
      .from('question_templates')
      .select('id, question_key')
      .eq('category_id', catId);

    const existingMap = new Map((existingQs || []).map(q => [q.question_key, q.id]));

    let displayOrder = 1;
    for (const q of cat.questions) {
      const qPayload = {
        category_id: catId,
        question_key: q.key,
        question_text: q.text,
        question_type: q.type,
        options: q.options,
        required: true,
        display_order: displayOrder++
      };

      if (existingMap.has(q.key)) {
        // Update (Idempotent)
        await supabase
          .from('question_templates')
          .update(qPayload)
          .eq('id', existingMap.get(q.key));
        qDuplicateChecks++;
      } else {
        // Insert
        await supabase
          .from('question_templates')
          .insert(qPayload);
        qsUpserted++;
      }
    }
  }

  console.log('--- SEED COMPLETE ---');
  console.log(`Categories processed: ${catsUpserted}`);
  console.log(`Questions inserted: ${qsUpserted}`);
  console.log(`Questions updated (idempotent): ${qDuplicateChecks}`);
}

seed().catch(console.error);
