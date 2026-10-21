# 默认宠物素材与动作

本轮使用内置 ImageGen，两次调用（初次生成及一次清理编辑），不使用CLI/API密钥。最终素材复制至 `public/assets/momo-life-atlas.png`，1254×1254 RGBA。旧 `momo.png` 保留为加载失败的静态后备，未覆盖用户导入图像。

## 最终图像提示词

初次生成：

> Create a production-ready ANIMATION SPRITE SHEET for a desktop companion. Exactly a 4-column by 4-row grid of 16 equally sized square cells. Transparent background, no borders, no text, no labels. Each cell contains the SAME small beautiful photorealistic baby white rabbit, natural believable rabbit anatomy and fine soft white fur, tiny natural black-brown eyes (not huge cartoon glass eyes), delicate pink inner ears, subtle nose and whiskers, wearing a simple very small sage green knitted scarf. Front three-quarter view facing slightly left, full body seated on hind paws, forepaws close together. Warm soft photographic studio lighting, subtle real depth, no toys, no plastic, no cartoon, no illustrations, no exaggerated smile. Rabbit fixed at exactly same position and scale and baseline in every cell, each full body fits within the cell with 12% margins, ears do not clip. The 16 cells in reading order are sequential animation frames of ONE subtle natural motion cycle: frames 1-3 neutral open eyes; frame 4 eyelids halfway down; frames 5-6 eyes gently closed; frame 7 eyelids reopening; frame 8 eyes open; frames 9-12 one ear subtly bends outwards and head tilts 5 degrees inquisitively; frames 13-15 head and ear slowly return to neutral; frame16 same as frame1. Other body parts remain consistent and stationary across frames, no bouncing, no pose jumps. Seamless character consistency and consistent lighting across frames. All frame cell backgrounds truly transparent including outside fur. Make the sheet 2048x2048 or higher square resolution. This is an actual sprite atlas intended to be cropped into 16 frames by CSS.

清理编辑：

> Repair this rabbit animation atlas for shipping. KEEP the exact same rabbit character and 4x4 grid and 16 sequential poses. Critical: completely REMOVE ALL the white speckles, stray marks, colored red/yellow artifacts, dust, background texture and debris outside the rabbit silhouettes. Background must be PERFECTLY empty alpha transparent, with only clean natural rabbit fur outlines, no checkerboard texture painted in. Also make every rabbit 12% smaller within its own cell, with all ear tips safely inside each cell; centered at exactly same coordinates and same scale and same bottom baseline for each of the 16 cells. Four equal columns and four equal rows, output square. Preserve the same natural white furry rabbit and sage green scarf and sequence of open eyes, blinking, one ear flop, neutral. No text, no cell borders. Clean professionally cut-out transparent sprites, no particle effects, no shadows extending into neighboring cells.

## 实现

实际输出没有严格遵守等距栅格。读图后用每帧单独CSS取景窗口，统一脚底位置，避免均分造成切脚和上下串帧；没有修改生成位图。

共享 `AnimatedPet` 播放：眨眼 `0,3,4,5,6,7,0`；耳部 `0,8…15,0`；问候完整闭环。随机闲置间隔减少机械循环感，触摸触发动作。不是整张图漂浮，不是实时3D模型，也没有用静态图宣称生成动画。

可见性、窗口隐藏和系统减少动态效果决定是否播放；非播放阶段不持续运行rAF。用户导入/生成的单张图片保持静态。登录、首页、宠物小屋与独立窗口复用同组件。

原生窗口已实际观察到睁眼、闭眼及侧耳的不同帧，证据 `evidence/pet-motion-v2-a.png`、`pet-motion-v2-b.png`；透明背景在奶油色页面无黑色底块或杂点。

## 0.5 当前默认呈现
0.3原图集第0帧为唯一纹理来源，PhotoPetScene固定裁切并连续局部网格变形，不再使用上文旧播放器切帧。保留原始资产字节，AnimatedPet WebGL失败也显示相同角色。头、耳、胸腹、鼻及眼部以连续函数驱动，足底固定。坐姿素材不等于完整四足步态。

## 0.6 当前默认呈现（替代0.5局部变形）
使用用户提供 rabbit-actions-15s.mp4 的全部362帧动作。源SHA256 d04d83d34c4bea6c5598dcd12f30452c0a8e1f00333380909347be8a8201f40c；原源不改动。macOS Vision逐帧前景分割，保留原RGB与画布，只增加alpha并编码VP9。背景圆圈移除、围巾与耳脚保留，poster取原视频第1帧同mask。没有插帧、反向、删动作、人工限帧或hover重启。原生video静音/完整画布/24fps1x循环。原片首尾姿态不同，循环接缝作为已知素材限制记录，不宣称无缝。

## 0.7 循环首尾连接（当前默认）
0.7历史版本momo-actions-loop.webm保留原362帧完全相同的RGBA解码前缀，原速24fps，再追加42帧（1.75s）连接。新增帧t=n/43，n=1..42，不含重复首尾端点，不以冻结伪装无缝。用显式耳/眼/鼻/围巾/身体对应的TPS双向形变、预乘纹理融合、signed-distance轮廓协调连接末尾与开头；纯Vision光流因双耳重影被弃，未使用。新循环是404帧/16.833s；新增段属于二维合成，非重新拍摄的真实三维动作，放大有轻微纹理滑移。数据及原生实测见evidence/momo007/asset-loop-manifest.json与asset-native-verification.md。

## 0.7.2 刚体跳跃连接

0.7.2默认momo-actions-hop.webm：原362帧各重复两次编码48fps，原动作仍为24fps原速。新增2秒桥接只对末姿态和首姿态作整数像素整体上移/落下，完全离画时切姿态；没有TPS、缩放、局部变形、叠影或模型外发。跳跃顶点有短暂离画，不能称为全程可见的真实三维转身。原0.7素材保留可回退。脚本scripts/prepare-rabbit-hop.py、证据evidence/momo009。

## 0.7.3 第一段翻身试用

用户接受第一候选耳尖裁切，要求先接入。默认momo-actions-roll.webm，原362帧保持24fps/原序，追加首段生成视频20–124帧，仅用Vision添加透明度，不做TPS、旋转、位移、变速或叠影。总467帧/19.458秒。存在已知耳尖裁切及首尾头角/清晰度差异。脚本scripts/prepare-rabbit-roll.py；本机原始候选及验收位于evidence/momo010、momo011（不纳入公开仓库）。
