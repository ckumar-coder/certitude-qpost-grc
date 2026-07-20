-- schema_v74_remove_maturity_assessment.sql
-- Removes the GRC Maturity Assessment module entirely (schema_v37), per
-- decision to drop it from this Qatar Post instance.
--
-- Drops all 5 tables in child-first order. CASCADE also removes any
-- indexes/FKs depending on them. Safe to re-run (IF EXISTS everywhere).

DROP TABLE IF EXISTS maturity_results CASCADE;
DROP TABLE IF EXISTS maturity_responses CASCADE;
DROP TABLE IF EXISTS maturity_assessments CASCADE;
DROP TABLE IF EXISTS maturity_questions CASCADE;
DROP TABLE IF EXISTS maturity_domains CASCADE;
