-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT,
    "raw_company_name" TEXT,
    "raw_company_slug" TEXT,
    "raw_title" TEXT,
    "title" TEXT,
    "original_url" TEXT,
    "original_url_match_key" TEXT,
    "resolved_url" TEXT,
    "resolved_url_match_key" TEXT,
    "posting_date" DATETIME,
    "posting_updated_date" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" DATETIME NOT NULL,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "is_parsed" BOOLEAN NOT NULL DEFAULT false,
    "is_classified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'backlog',
    "raw_location_list" JSONB,
    "normalized_location_list" JSONB,
    "raw_mode_list" JSONB,
    "normalized_mode_list" JSONB,
    "collector" TEXT,
    "collected_at" DATETIME NOT NULL,
    "parser" TEXT,
    "raw_salary" JSONB,
    "salary_low" INTEGER,
    "salary_high" INTEGER,
    "salary_period" TEXT,
    "description" TEXT,
    "location_match" BOOLEAN,
    "location_match_place" TEXT,
    "location_match_mode" TEXT,
    "is_repost" BOOLEAN,
    "alignment_score" INTEGER,
    "alignment_rationale" TEXT,
    CONSTRAINT "Job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "match_key" TEXT,
    "employee_satisfaction" INTEGER,
    "customer_satisfaction" INTEGER,
    "work_life_balance" INTEGER,
    "political_alignment" INTEGER,
    "employee_satisfaction_rationale" TEXT,
    "customer_satisfaction_rationale" TEXT,
    "work_life_balance_rationale" TEXT,
    "political_alignment_rationale" TEXT,
    "scored_at" DATETIME,
    "scores_guessed" JSONB,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "enriched_at" DATETIME,
    "enrichment_status" TEXT,
    "enrichment_uncertain" BOOLEAN NOT NULL DEFAULT false,
    "enrichment_flags" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AtsSlug" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "parser" TEXT NOT NULL,
    "collector" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" DATETIME NOT NULL,
    CONSTRAINT "AtsSlug_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lookup_text" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "place_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "outline" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "search_terms" JSONB,
    "location" TEXT,
    "radius" INTEGER,
    "expiry_threshold" INTEGER,
    "title_head_nouns" JSONB,
    "title_levels" JSONB,
    "title_suffixes" JSONB,
    "title_removal_words" JSONB,
    "source_priority_list" JSONB,
    "resolution_fast_concurrency" INTEGER,
    "resolution_slow_concurrency" INTEGER,
    "resolution_slow_pause_seconds" INTEGER,
    "repost_gap_days" INTEGER,
    "promotion_threshold" REAL,
    "score_expiry_days" INTEGER,
    "guessed_score_expiry_days" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Trace" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "run_id" TEXT NOT NULL,
    "job_id" TEXT,
    "company_id" TEXT,
    "step" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "collector" TEXT,
    "domain" TEXT,
    "detail" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkLogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "job_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Job_original_url_match_key_idx" ON "Job"("original_url_match_key");

-- CreateIndex
CREATE INDEX "Job_resolved_url_match_key_idx" ON "Job"("resolved_url_match_key");

-- CreateIndex
CREATE INDEX "Job_company_id_title_idx" ON "Job"("company_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Company_match_key_key" ON "Company"("match_key");

-- CreateIndex
CREATE UNIQUE INDEX "AtsSlug_slug_key" ON "AtsSlug"("slug");

-- CreateIndex
CREATE INDEX "AtsSlug_collector_idx" ON "AtsSlug"("collector");

-- CreateIndex
CREATE UNIQUE INDEX "Place_lookup_text_key" ON "Place"("lookup_text");

