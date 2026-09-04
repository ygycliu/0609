#!/bin/bash
# Semantica 启动脚本
# 使用 ComfyUI venv（已有 torch/transformers/sentence-transformers 等依赖）

VENV=/home/ygycliu/ComfyUI/.venv
export PATH="$VENV/bin:$PATH"

cd /opt/ai-consulting-center

echo "=== Semantica 0.6.6 ==="
echo "Python: $($VENV/bin/python --version)"
echo ""

# 运行健康检查
$VENV/bin/python -m semantica.cli doctor

echo ""
echo "=== 快速测试 ==="
$VENV/bin/python -c "
from semantica.context import ContextGraph
g = ContextGraph(advanced_analytics=True)
did = g.record_decision(
    category='test',
    scenario='Semantica deployment verification',
    reasoning='Testing if the context graph records decisions correctly',
    outcome='success',
    confidence=0.99,
)
print(f'✅ Decision recorded: {did}')
chain = g.trace_decision_chain(did)
print(f'✅ Decision chain retrieved: {len(chain)} steps')
"

echo ""
echo "=== 启动 Semantica ==="
echo "Docs: https://docs.getsemantica.ai/"
echo ""
$VENV/bin/python -m semantica.cli --help
