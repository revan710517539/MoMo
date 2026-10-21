# MOMO005 · 恢复原兔与完整工作流实演

人类决策者：用户；owner：root/mac16。范围为当前macOS应用本地修复、隔离测试流程与开发包；不新增观察权限、不外发、不删除正常工具/记忆/任务。

症状：0.4将0.3写实侧坐兔替换为程序化三维玩偶，违反既有角色一致性；旧图集切帧不顺；收起CSS后native minimize产生第二段Dock动画，展开show先于renderer初始帧可能闪现。

首个权威分歧：AnimatedPet默认source从原素材变为PetScene程序化模型。原素材保留，应直接修默认消费者，保持位图字节不变；固定原atlas第0帧UV取景后局部连续网格变形，不再切图或换角色。

角色基准：public/assets/momo-life-atlas.png第0帧，crop x47.5/y37/w300/h300。SHA256 73fb6f7b534e61531b8072d3f1a99c93b2700f6ed49f695b046596465494f56b。更早momo.png和用户单图不覆盖。不能将坐姿纹理称为已完成真实四足行走资产。

当前链：原角色文件存在→默认组件改用3D→所有窗口外观变化。目标链：原角色固定纹理→耳/头/胸腹局部连续变形→登录/工作台/宠物屋/桌面复用。隐藏/减少动态仍暂停，fallback同一原角色。

窗口链：收起emit→renderer缩小→main.hide；展开窗口opacity0→prepare样式→双rAF确认→opacity1和unfold→complete。原生黄色最小化保留系统语义，双击宠物可恢复。逆向/重复/锁屏动作有取消与超时降级，不可见宠物拒绝隐藏主窗。

分工：runtime_ui owns PhotoPetScene/AnimatedPet与动作测试；table_engine owns pet-controller与窗口测试；china_market独立只读工作流审查及新增journey测试；root owns main/preload/transition CSS、其余必要修复、真实CUA实演与打包。

产品审视：身份一致优先于特效；动作轻、连续、脚底稳定，不能整图飘浮/融图假装流畅。建议必须由真实事件触发，优化/回退需可见前后参数与版本。
技术审视：复用原素材、Three渲染、SQLite/companion/optimizer，不新增账号/数据库/第二观察控制面；PNG不编辑，不使用图像生成改变角色。生成内容仍无新系统权限。

完整验收：新隔离profile登录→手动开启受控观察→明确选测试目录→真实文件变化→宠物建议→接受打开对应工具→三次成功低风险参数使用→自动新版本→一键回到立即前版并再次运行核验；同时宠物连续动作、桌面收起和双击展开须实际检查。流程中的测试文件都位于evidence隔离目录，不接触用户业务文件。不存在模型配置时不伪造模型调用或质量验收。

保护与回退：正常空间工具/记忆/设置不改变；素材哈希保留；evidence/momo005-backup/source-before-0.5.tar.gz和0.4 ZIP保留。退出后可恢复旧应用，数据库只保留向后兼容settings与不可变versions。最终证据evidence/pet-motion-journey-verification.md。

采用问题链修复规范。Skill督导脚本既有引用路径缺失，沿用本地任务卡/独立复核/测试与原生验收，不安装新控制面。

完成：0.5.0本机开发包，151/151测试；原生真实文件观察→宠物建议→3次改名→自动v2→回退v3完整完成，最终包重启记忆与历史读回通过。正常3工具指纹不变。最终证据 evidence/pet-motion-journey-verification.md，下一责任人为用户视觉体验验收；完整四足步态资产不在本轮坐姿素材实现能力内。
