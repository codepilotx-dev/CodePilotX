# 外部 Agent CLI 预留接口

当前版本**尚未提供** CodePilotX CLI。外部 Agent 不得执行下列命令、模拟其结果，或声称任务已经通过 CLI 创建。

未来计划保留的调用形式为：

```text
codepilotx task plan create --project <id> --stdin --json
```

标准输入将是 UTF-8 JSON 对象：

```json
{
  "tasks": [
    {
      "title": "实现任务规划入口",
      "description": "目标、交付范围、验收标准和约束。",
      "priority": "none"
    }
  ]
}
```

未来 JSON 输出会包含已创建任务、首个失败位置和未执行任务。多任务保持顺序创建；首个失败后停止，不承诺批量原子事务。
