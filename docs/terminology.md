# 桌面宠物术语

| ID | 中文名称 | 含义与边界 | 代码对应 / 来源 | 状态 |
|---|---|---|---|---|
| PET01 | 桌面宠物 | 独立透明窗口中的原兔子，不是工作台预览 | pet.html、pet.jsx、createPetWindow | 已核实 |
| PET02 | 停靠 | 保持陪伴运行，收至显示器可用区域底边细条 | controller.dock、pet.docked；pet-interactions-task.md | 已实现 |
| PET03 | 探出 | 鼠标接近细条时临时显示，移开后退回；不等于取消停靠 | controller.peek | 已实现 |
| PET04 | 安静模式 | 暂停提醒，原兔子闭眼睡眠并半透明 | pet.quiet、AnimatedPet.sleeping | 已实现 |
| PET05 | 工作台收起 | 隐藏主工作台并保留宠物，与停靠分离 | controller.folded、fold/unfold | 已核实 |
