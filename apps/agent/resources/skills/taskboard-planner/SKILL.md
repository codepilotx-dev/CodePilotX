---
name: taskboard-planner
description: 将长期工作目标规划为 CodePilotX 顶级任务中的轻量步骤、递归子任务和 allOf 前置条件。用户要求创建、拆分、整理或继续规划任务时使用；确认预览后原子写入。
allowed-tools:
  - request_user_input
  - taskboard_read
  - taskboard_create
  - taskboard_link_current
  - taskboard_plan_read
  - taskboard_plan_apply
  - taskboard_step_update
  - taskboard_blocker_create
  - taskboard_blocker_resolve
---

# 任务看板规划

把用户的长期成果组织成可跨会话继续的任务树。轻量步骤用于同一任务内的简单检查点；需要独立会话、上下文或验收的工作才创建子任务。

## 选择目标任务

先调用 `taskboard_plan_read` 读取当前会话关联任务及已有计划，避免重复创建。

- 用户要继续已有任务时，当前会话必须直接关联该任务。未关联时，先展示目标任务并请求明确确认，再调用 `taskboard_link_current`；关联结果包含任务上下文，阅读后才能规划。
- 用户要创建新的顶级长期任务时，先预览根任务，确认后调用一次 `taskboard_create`，再经确认用 `taskboard_link_current` 关联当前会话，然后读取计划。
- 当前会话没有项目时停止，提示用户先选择项目。

只在目标、交付物或验收标准无法从用户描述、任务上下文和代码库可靠推断时提问。问题必须影响任务拆分或依赖关系。

## 规划预览

结合已有计划展示一个混合预览，每项包含稳定的临时 ID、标题、类型、目的和顺序；有真实依赖时标明 `allOf` 前置项。

- 调研、代码扫描、一次性确认和短验证通常是轻量步骤。
- 需要独立会话、可单独排期或验收的实现、迁移和已确认缺陷通常是子任务。
- 不重复已有步骤或子任务；需要调整已有轻量步骤时使用 `taskboard_step_update`，不要再创建一份。
- 不预先创建尚未发生的 Bug、阻碍或补救任务。真实阻碍出现后用 `taskboard_blocker_create` 记录；解决时用 `taskboard_blocker_resolve`。
- 不伪造日期、标签 ID、负责人或前置条件。

预览后用一次 `request_user_input` 询问是否按当前内容创建全部计划项。用户取消、要求调整或没有明确确认时，不得写入。

## 原子写入

用户明确确认后，只调用一次 `taskboard_plan_apply`：

- `expectedVersion` 使用最近一次 `taskboard_plan_read` 返回的父任务版本。
- `items` 同时包含确认的轻量步骤和子任务，每个 `clientId` 在本批次唯一。
- `dependencies` 只引用本批次 `clientId`，表达同一父任务内的 `allOf` 条件。
- 不逐项调用 `taskboard_create` 代替计划提交，不因失败改变预览后重放。

成功后列出创建的步骤、子任务和等待条件。失败时说明安全错误并保留原预览；原子提交不会留下半套计划。

用户的业务确认不能绕过工具审批或权限策略。
