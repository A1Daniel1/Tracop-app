-- Fix CHECK constraints for product proposals
-- reviewed_by and reviewed_at required for both approved and rejected (after review)
-- Drop old unique index that blocks re-proposing rejected products

ALTER TABLE catalog.products
  DROP CONSTRAINT IF EXISTS products_proposal_review_check,
  ADD CONSTRAINT products_proposal_review_check
    CHECK (
      (status = 'approved' AND proposed_by IS NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR
      (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR
      (status = 'pending_review')
    );

-- Drop old unique index on (category_id, lower(name)) that doesn't respect status
DROP INDEX IF EXISTS catalog.products_category_name_unique;

-- The replacement index products_category_search_text_active_unique already exists from 0011
-- It uses (category_id, search_text) WHERE deleted_at IS NULL AND status IN ('approved', 'pending_review')