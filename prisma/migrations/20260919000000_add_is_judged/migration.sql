-- AlterTable
ALTER TABLE "Job" ADD COLUMN "is_judged" BOOLEAN NOT NULL DEFAULT false;

-- Jobs stored before this column existed were never marked by scoring, so
-- they are marked once here by the rule scoring applies from now on.
UPDATE "Job"
SET "is_judged" = true
WHERE "is_resolved" = true
  AND "is_parsed" = true
  AND "is_classified" = true
  AND (
    "alignment_score" IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM "Company"
      WHERE "Company"."id" = "Job"."company_id"
        AND (
          "Company"."employee_satisfaction" IS NOT NULL
          OR "Company"."customer_satisfaction" IS NOT NULL
          OR "Company"."work_life_balance" IS NOT NULL
          OR "Company"."political_alignment" IS NOT NULL
        )
    )
  );
