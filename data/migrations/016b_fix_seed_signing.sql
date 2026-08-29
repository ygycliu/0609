-- ============================================================
-- Migration 016b: 修复 certified_organization 种子 signing_entity_id
-- ============================================================

-- 把 HZ-CN-001 关联到 signing_entity.code = 'A' (华中)
UPDATE certified_organization SET signing_entity_id = (
    SELECT id FROM signing_entity WHERE entity_code = 'A' AND deleted_at IS NULL LIMIT 1
)
WHERE code = 'HZ-CN-001' AND signing_entity_id IS NULL AND deleted_at IS NULL;

-- 把 ZR-CN-NX-001 关联到 signing_entity.code = 'B' (中认宁夏)
UPDATE certified_organization SET signing_entity_id = (
    SELECT id FROM signing_entity WHERE entity_code = 'B' AND deleted_at IS NULL LIMIT 1
)
WHERE code = 'ZR-CN-NX-001' AND signing_entity_id IS NULL AND deleted_at IS NULL;

-- 验证
SELECT c.code, c.name, se.entity_code, se.name AS signing_name
FROM certified_organization c
LEFT JOIN signing_entity se ON se.id = c.signing_entity_id
WHERE c.deleted_at IS NULL;
